import Router from "koa-router";
import { QueryTypes, Op } from "sequelize";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import Document from "@server/models/Document";
import Integration from "@server/models/Integration";
import { IntegrationService, IntegrationType } from "@shared/types";
import { globalEventQueue } from "@server/queues";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import DocumentIndexProcessor from "../processors/DocumentIndexProcessor";
import { VectorStoreService } from "../VectorStoreService";
import { ChatService } from "../ChatService";
import * as T from "./schema";

interface RAGSettings {
  RAG_OPENAI_API_KEY?: string;
}

const router = new Router();

// Debug middleware to log all requests
router.use(async (ctx, next) => {
    await next();
});

/**
 * Index a document into the vector store
 */
router.post(
    "rag.index",
    auth(),
    validate(T.RagIndexDocumentSchema),
    async (ctx: APIContext<T.RagIndexDocumentReq>) => {
        const { content, metadata = {} } = ctx.input.body;
        const { user } = ctx.state.auth;

        // Check if RAG is configured
        const integration = await Integration.findOne({
            where: {
                teamId: user.teamId,
                service: IntegrationService.Rag,
                type: IntegrationType.Post,
            },
        });

        const settings = integration?.settings as RAGSettings | undefined;

        if (!settings?.RAG_OPENAI_API_KEY) {
            ctx.body = {
                success: false,
                message: "RAG not configured",
            };
            return;
        }

        const vectorStore = VectorStoreService.getInstance();

        // Add user and team context to metadata
        const enrichedMetadata = {
            ...metadata,
            userId: user.id,
            teamId: user.teamId,
            indexedAt: new Date().toISOString(),
        };

        await vectorStore.indexDocument(content, enrichedMetadata);

        ctx.body = {
            success: true,
            message: "Document indexed successfully",
        };
    }
);

/**
 * Batch index all published documents
 */
router.post(
    "rag.indexAll",
    auth(),
    validate(T.RagIndexAllSchema),
    async (ctx: APIContext<T.RagIndexAllReq>) => {
        const { collectionId, teamId, force = false } = ctx.input.body;
        const { user } = ctx.state.auth;

        const targetTeamId = teamId || user.teamId;

        // Check if RAG is configured
        const integration = await Integration.findOne({
            where: {
                teamId: targetTeamId,
                service: IntegrationService.Rag,
                type: IntegrationType.Post,
            },
        });

        const settings = integration?.settings as RAGSettings | undefined;

        if (!settings?.RAG_OPENAI_API_KEY) {
            ctx.body = {
                success: false,
                message: "RAG not configured",
                queued: 0,
            };
            return;
        }

        const vectorStore = VectorStoreService.getInstance();

        // Build query conditions
        const where: Record<string, unknown> = {
            publishedAt: { [Op.ne]: null },
            teamId: targetTeamId,
        };

        if (collectionId) {
            where.collectionId = collectionId;
        }

        // Find all published documents
        const documents = await Document.findAll({
            where,
            include: [
                {
                    association: "collection",
                    required: true,
                },
            ],
        });

        const queue = globalEventQueue();
        let queued = 0;
        const queuedDocuments: { id: string; title: string }[] = [];

        for (const document of documents) {
            await queue.add({
                name: "documents.index",
                documentId: document.id,
                teamId: document.teamId,
                collectionId: document.collectionId,
                data: {
                    force: force,
                },
            });
            queued++;
            queuedDocuments.push({ id: document.id, title: document.title });
        }

        ctx.body = {
            success: true,
            data: {
                total: documents.length,
                queued,
                queuedDocuments,
                message: "Documents have been queued for indexing",
            },
        };
    }
);

/**
 * Delete a document from the vector store
 */
router.post(
    "rag.delete",
    auth(),
    validate(T.RagDeleteDocumentSchema),
    async (ctx: APIContext<T.RagDeleteDocumentReq>) => {
        const { documentId } = ctx.input.body;

        const vectorStore = VectorStoreService.getInstance();
        await vectorStore.deleteDocument(documentId);

        ctx.body = {
            success: true,
            message: "Document deleted successfully",
        };
    }
);

/**
 * Search for similar documents
 */
router.post(
    "rag.search",
    auth(),
    validate(T.RagSearchSchema),
    async (ctx: APIContext<T.RagSearchReq>) => {
        const { query, k } = ctx.input.body;

        const vectorStore = VectorStoreService.getInstance();
        const results = await vectorStore.similaritySearchWithScore(query, k);

        ctx.body = {
            data: results.map(([doc, score]) => ({
                content: doc.pageContent,
                metadata: doc.metadata,
                score,
            })),
        };
    }
);



// ...

/**
 * Stream answer to a question using RAG
 */
router.post(
    "rag.chat.stream",
    auth(),
    validate(T.RagChatSchema),
    async (ctx: APIContext<T.RagChatReq>) => {
        const { question, k, history, collectionIds } = ctx.input.body;
        const { user } = ctx.state.auth;

        Logger.info("plugins", `RAG: Starting chat stream for user ${user.id}`);

        ctx.request.socket.setTimeout(0);
        ctx.req.socket.setNoDelay(true);
        ctx.req.socket.setKeepAlive(true);

        ctx.respond = false;
        ctx.res.statusCode = 200;
        ctx.res.setHeader("Content-Type", "text/event-stream");
        ctx.res.setHeader("Cache-Control", "no-cache");
        ctx.res.setHeader("Connection", "keep-alive");
        ctx.res.setHeader("X-Accel-Buffering", "no");
        
        ctx.res.flushHeaders();

        const chatService = ChatService.getInstance();
        
        const cleanup = () => {
            if (!ctx.res.writableEnded) {
                 ctx.res.end();
            }
        };
        
        ctx.req.on("close", cleanup);
        ctx.req.on("finish", cleanup);
        ctx.req.on("error", cleanup);

        try {
            ctx.res.write(`: ping\n\n`);
            if ((ctx.res as any).flush) (ctx.res as any).flush();
            
            Logger.debug("plugins", "RAG: Calling chatService.streamAnswer");
            // Pass teamId to streamAnswer to allow loading team-specific settings
            for await (const chunk of chatService.streamAnswer(question, k, history, collectionIds, user.teamId)) {
                if (ctx.res.writableEnded || ctx.res.destroyed) break;

                ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                if ((ctx.res as any).flush) (ctx.res as any).flush();
            }
            Logger.debug("plugins", "RAG: Stream completed successfully");
        } catch (error) {
            Logger.error("RAG chat stream failed", error as Error);
            if (!ctx.res.writableEnded && !ctx.res.destroyed) {
                ctx.res.write(
                    `data: ${JSON.stringify({
                        type: "error",
                        data: (error as Error).message,
                    })}\n\n`
                );
            }
        } finally {
            if (!ctx.res.writableEnded && !ctx.res.destroyed) {
                ctx.res.end();
            }
            ctx.req.off("close", cleanup);
            ctx.req.off("finish", cleanup);
            ctx.req.off("error", cleanup);
        }
    }
);

/**
 * Get all indexed documents
 */
router.post(
    "rag.documents",
    auth(),
    validate(T.RagDocumentsSchema),
    async (ctx: APIContext<T.RagDocumentsReq>) => {
        const { teamId } = ctx.input.body;
        const { user } = ctx.state.auth;

        const targetTeamId = teamId || user.teamId;

        // Get all indexed documents with their chunk counts
        const indexedDocsResult = await Document.sequelize!.query<{
            documentId: string;
            documentTitle: string;
            chunks: string;
            updatedAt: string;
        }>(
            `SELECT 
                metadata->>'documentId' as "documentId",
                metadata->>'documentTitle' as "documentTitle",
                COUNT(*) as chunks,
                MAX(metadata->>'updatedAt') as "updatedAt"
            FROM rag_vectors
            WHERE metadata->>'teamId' = :teamId
            GROUP BY metadata->>'documentId', metadata->>'documentTitle'
            ORDER BY MAX(metadata->>'updatedAt') DESC`,
            {
                replacements: { teamId: targetTeamId },
                type: QueryTypes.SELECT,
            }
        );

        const indexedDocuments = indexedDocsResult.map((row) => ({
            documentId: row.documentId,
            documentTitle: row.documentTitle,
            chunks: parseInt(row.chunks, 10),
            updatedAt: row.updatedAt,
            status: "indexed" as const,
        }));

        // Get indexing jobs from queue
        const { globalEventQueue, processorEventQueue } = await import("@server/queues");
        const globalQueue = globalEventQueue();
        const processorQueue = processorEventQueue();

        const [
            globalActive,
            globalDelayed,
            globalWaiting,
            processorActive,
            processorWaiting,
            processorDelayed,
            processorFailed
        ] = await Promise.all([
            globalQueue.getActive(),
            globalQueue.getDelayed(),
            globalQueue.getWaiting(),
            processorQueue.getActive(),
            processorQueue.getWaiting(),
            processorQueue.getDelayed(),
            processorQueue.getFailed(),
        ]);

        // Filter RAG-related jobs and extract document info
        const indexingDocs = new Map<string, {
            documentId: string;
            status: "indexing" | "pending" | "failed" | "retrying";
            error?: string;
        }>();

        // 1. Check global queue for delayed/debounced events
        for (const job of [...globalActive, ...globalDelayed, ...globalWaiting]) {
            if (
                job.data.name === "documents.update.debounced" ||
                job.data.name === "documents.publish" ||
                job.data.name === "documents.index"
            ) {
                // If it's active in global queue, it's about to be processed (moved to processor queue)
                // If it's delayed/waiting, it's pending
                const status = job.data.name === "documents.update.debounced" ? "pending" : "indexing";
                
                indexingDocs.set(job.data.documentId, {
                    documentId: job.data.documentId,
                    status,
                });
            }
        }

        // 2. Check processor queue for actual processing jobs
        for (const job of [...processorActive, ...processorWaiting]) {
            const event = job.data?.event;
            if (event && (
                event.name === "documents.publish" || 
                event.name === "documents.update" || 
                event.name === "documents.update.debounced" ||
                event.name === "documents.index"
            )) {
                indexingDocs.set(event.documentId, {
                    documentId: event.documentId,
                    status: "indexing",
                });
            }
        }

        // 3. Check processor queue for delayed (retrying) jobs
        for (const job of processorDelayed) {
            const event = job.data?.event;
            if (event && (
                event.name === "documents.publish" || 
                event.name === "documents.update" || 
                event.name === "documents.update.debounced" ||
                event.name === "documents.index"
            )) {
                // If it's in delayed queue, it's waiting for retry
                indexingDocs.set(event.documentId, {
                    documentId: event.documentId,
                    status: "retrying",
                });
            }
        }

        // 3. Check processor queue for failed jobs
        for (const job of processorFailed) {
            const event = job.data?.event;
            if (event && (
                event.name === "documents.publish" || 
                event.name === "documents.update" || 
                event.name === "documents.update.debounced" ||
                event.name === "documents.index"
            )) {
                // Only show as failed if not currently indexing/pending (retry or re-queued)
                if (!indexingDocs.has(event.documentId)) {
                    indexingDocs.set(event.documentId, {
                        documentId: event.documentId,
                        status: "failed",
                        error: job.failedReason,
                    });
                }
            }
        }

        // Get document titles for indexing documents
        const indexingDocIds = Array.from(indexingDocs.keys());
        const indexingDocuments = [];

        if (indexingDocIds.length > 0) {
            const docs = await Document.findAll({
                where: {
                    id: indexingDocIds,
                    teamId: targetTeamId,
                },
                attributes: ["id", "title"],
            });

            for (const doc of docs) {
                const info = indexingDocs.get(doc.id);
                if (info) {
                    indexingDocuments.push({
                        documentId: doc.id,
                        documentTitle: doc.title,
                        chunks: 0,
                        status: info.status,
                        error: info.error,
                    });
                }
            }
        }

        ctx.body = {
            data: {
                indexed: indexedDocuments,
                indexing: indexingDocuments,
            },
        };
    }
);

/**
 * Get chunks for a specific document
 */
router.post(
    "rag.document.chunks",
    auth(),
    validate(T.RagDocumentChunksSchema),
    async (ctx: APIContext<T.RagDocumentChunksReq>) => {
        const { documentId } = ctx.input.body;
        const { user } = ctx.state.auth;

        // Get all chunks for this document
        const chunksResult = await Document.sequelize!.query<{
            id: string;
            content: string;
            metadata: string;
        }>(
            `SELECT 
                id,
                content as content,
                metadata::text as metadata
            FROM rag_vectors
            WHERE metadata->>'documentId' = :documentId
            AND metadata->>'teamId' = :teamId
            ORDER BY id`,
            {
                replacements: {
                    documentId,
                    teamId: user.teamId,
                },
                type: QueryTypes.SELECT,
            }
        );

        const chunks = chunksResult.map((row, index) => ({
            index: index + 1,
            id: row.id,
            content: row.content,
            metadata: JSON.parse(row.metadata),
        }));

        ctx.body = {
            data: {
                documentId,
                chunks,
            },
        };
    }
);



/**
 * Get RAG settings
 */
router.post(
    "rag.settings.get",
    auth(),
    validate(T.RagGetSettingsSchema),
    async (ctx: APIContext<T.RagGetSettingsReq>) => {
        const { user } = ctx.state.auth;

        const integration = await Integration.findOne({
            where: {
                teamId: user.teamId,
                service: IntegrationService.Rag,
                type: IntegrationType.Post, // Using 'post' as a generic type since we don't have 'settings' type
            },
        });

        ctx.body = {
            success: true,
            data: integration?.settings || {},
        };
    }
);

/**
 * Set RAG settings
 */
router.post(
    "rag.settings.set",
    auth(),
    validate(T.RagSetSettingsSchema),
    async (ctx: APIContext<T.RagSetSettingsReq>) => {
        const { user } = ctx.state.auth;
        const settings = ctx.input.body;

        // Check if user is admin
        if (!user.isAdmin) {
            ctx.throw(403, "Only admins can configure RAG settings");
        }

        let integration = await Integration.findOne({
            where: {
                teamId: user.teamId,
                service: IntegrationService.Rag,
                type: IntegrationType.Post,
            },
        });

        if (integration) {
            integration.settings = {
                ...integration.settings,
                ...settings,
            } as any;
            await integration.save();
        } else {
            await Integration.create({
                teamId: user.teamId,
                userId: user.id,
                service: IntegrationService.Rag,
                type: IntegrationType.Post,
                settings: settings as any,
            });
        }

        ctx.body = {
            success: true,
            message: "Settings saved successfully",
        };
    }
);

export default router;
