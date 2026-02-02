import env from "@server/env";
import Logger from "@server/logging/Logger";
import Document from "@server/models/Document";
import type { Event } from "@server/types";
import BaseProcessor from "@server/queues/processors/BaseProcessor";
import { globalEventQueue } from "@server/queues";
import { VectorStoreService } from "../VectorStoreService";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";

/**
 * Processor for indexing documents into the RAG vector store.
 * 
 * Uses a debounce strategy to avoid indexing documents too frequently during
 * collaborative editing sessions. Only published documents are indexed.
 */
export default class DocumentIndexProcessor extends BaseProcessor {
    static applicableEvents: Event["name"][] = [
        "documents.publish",
        "documents.update",
        "documents.update.debounced",
        "documents.delete",
        "documents.archive",
        "documents.index",
    ];

    async perform(event: Event) {
        switch (event.name) {
            case "documents.index":
            case "documents.publish": {
                // Immediately index when a document is published
                await this.indexDocument(event.documentId, {
                    force: event.data?.force,
                });
                break;
            }

            case "documents.update": {
                // For updates, use debounce to avoid frequent re-indexing
                // Only queue if the document is already published
                const document = await Document.findByPk(event.documentId, {
                    attributes: ["publishedAt"],
                });

                if (!document?.publishedAt) {
                    return;
                }

                // Queue a delayed indexing event (will be debounced)
                await globalEventQueue().add(
                    { ...event, name: "documents.update.debounced" },
                    {
                        // Wait 5 minutes in production, 30 seconds in development
                        delay: (env.isProduction ? 5 : 0.5) * 60 * 1000,
                        // Remove any existing delayed job for this document
                        jobId: `rag-index-${event.documentId}`,
                    }
                );
                break;
            }

            case "documents.update.debounced": {
                // Re-index the document after debounce period
                const document = await Document.findByPk(event.documentId, {
                    attributes: ["updatedAt", "publishedAt"],
                });

                if (!document) {
                    return;
                }

                // Only index published documents
                if (!document.publishedAt) {
                    return;
                }

                // If the document was updated after this event was created,
                // skip indexing (there's a newer event in the queue)
                if (document.updatedAt > new Date(event.createdAt)) {
                    return;
                }

                await this.indexDocument(event.documentId, {
                    force: event.data?.force,
                });
                break;
            }

            case "documents.delete":
            case "documents.archive": {
                // Remove from vector store when document is deleted or archived
                await this.removeDocument(event.documentId);
                break;
            }

            default:
        }
    }

    /**
     * Index a document into the vector store.
     * 
     * @param documentId the document ID to index.
     * @param options options for indexing.
     */
    private async indexDocument(
        documentId: string,
        options: { force?: boolean } = {}
    ): Promise<void> {
        try {
            const document = await Document.findByPk(documentId, {
                include: [
                    {
                        association: "collection",
                        required: true,
                    },
                    {
                        association: "createdBy",
                        required: true,
                    },
                ],
            });

            if (!document || !document.publishedAt) {
                Logger.info("plugins", `RAG: Skipping unpublished document ${documentId}`);
                return;
            }

            // Convert document content to plain text
            const content = await DocumentHelper.toMarkdown(document, {
                includeTitle: false,
            });

            if (!content || content.trim().length === 0) {
                Logger.info("plugins", `RAG: Skipping empty document ${documentId}`);
                return;
            }

            const vectorStore = VectorStoreService.getInstance();

            let needsReindex = true;

            // Check if document needs re-indexing by comparing timestamps
            if (!options.force) {
                const existingMetadata = await vectorStore.findDocumentMetadata(
                    document.id
                );

                needsReindex =
                    !existingMetadata ||
                    !existingMetadata.updatedAt ||
                    new Date(existingMetadata.updatedAt as string) < document.updatedAt;
            }

            if (!needsReindex) {
                Logger.info(
                    "plugins",
                    `RAG: Document ${documentId} is already up-to-date in vector store`
                );
                return;
            }

            // Remove old vectors for this document
            await this.removeDocument(documentId);

            // Index the document with metadata
            await vectorStore.indexDocument(content, {
                documentId: document.id,
                documentTitle: document.title,
                collectionId: document.collectionId,
                teamId: document.teamId,
                createdById: document.createdById,
                updatedAt: document.updatedAt.toISOString(),
                publishedAt: document.publishedAt.toISOString(),
            });

            Logger.info("plugins", `RAG: Successfully indexed document ${documentId}`);
        } catch (error) {
            Logger.error("Failed to index document", error, {
                documentId,
            });
            throw error;
        }
    }

    /**
     * Remove a document from the vector store.
     * 
     * @param documentId the document ID to remove.
     */
    private async removeDocument(documentId: string): Promise<void> {
        try {
            const vectorStore = VectorStoreService.getInstance();
            await vectorStore.deleteDocument(documentId);
            Logger.info("plugins", `RAG: Removed document ${documentId} from vector store`);
        } catch (error) {
            Logger.error("Failed to remove document from vector store", error, {
                documentId,
            });
            // Don't throw - removal failures shouldn't block indexing
        }
    }
}
