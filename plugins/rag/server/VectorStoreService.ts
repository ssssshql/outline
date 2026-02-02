import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document as LangChainDocument } from "@langchain/core/documents";
import { Pool } from "pg";
import { QueryTypes } from "sequelize";
import { sequelize } from "@server/storage/database";
import Logger from "@server/logging/Logger";
import serverEnv from "@server/env";
import Integration from "@server/models/Integration";
import { IntegrationService, IntegrationType } from "@shared/types";
import env from "./env";

/**
 * Service for managing vector store operations
 */
export class VectorStoreService {
    private static instance: VectorStoreService;
    private pool: Pool | null = null;
    private initialized = false;

    private constructor() { }

    /**
     * Get singleton instance
     */
    public static getInstance(): VectorStoreService {
        if (!VectorStoreService.instance) {
            VectorStoreService.instance = new VectorStoreService();
        }
        return VectorStoreService.instance;
    }

    /**
     * Get embeddings instance based on settings
     */
    private async getEmbeddings(settings: Record<string, any> = {}): Promise<OpenAIEmbeddings> {
        const apiKey = settings.RAG_OPENAI_API_KEY;
        const baseURL = settings.RAG_OPENAI_BASE_URL;
        const model = settings.RAG_EMBEDDING_MODEL;

        if (!apiKey) {
            throw new Error("需要配置OpenAI API密钥才能进行会话");
        }

        return new OpenAIEmbeddings({
            apiKey,
            batchSize: 512,
            model,
            configuration: baseURL ? { baseURL } : undefined,
        });
    }

    /**
     * Get vector store instance based on settings
     */
    private async getVectorStore(settings: Record<string, any> = {}): Promise<PGVectorStore> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.pool) {
            throw new Error("Database pool not initialized");
        }

        const embeddings = await this.getEmbeddings(settings);

        return new PGVectorStore(embeddings, {
            pool: this.pool,
            tableName: "rag_vectors",
            collectionName: "outline_documents",
            collectionTableName: "rag_collections",
            columns: {
                idColumnName: "id",
                vectorColumnName: "vector",
                contentColumnName: "content",
                metadataColumnName: "metadata",
            },
        });
    }

    /**
     * Get settings for a team
     */
    private async getTeamSettings(teamId: string): Promise<Record<string, any>> {
        if (!teamId) return {};
        
        try {
            const integration = await Integration.findOne({
                where: {
                    teamId,
                    service: IntegrationService.Rag,
                    type: IntegrationType.Post,
                },
            });
            return integration?.settings || {};
        } catch (error) {
            Logger.warn("Failed to fetch team RAG settings", error);
            return {};
        }
    }

    /**
     * Initialize the database connection
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Create a new pg Pool instance using database URL or individual config
            if (serverEnv.DATABASE_URL) {
                this.pool = new Pool({
                    connectionString: serverEnv.DATABASE_URL,
                    max: 5,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 2000,
                    ssl: serverEnv.isProduction && serverEnv.PGSSLMODE !== "disable"
                        ? { rejectUnauthorized: false }
                        : false,
                });
            } else {
                this.pool = new Pool({
                    host: serverEnv.DATABASE_HOST,
                    port: serverEnv.DATABASE_PORT || 5432,
                    database: serverEnv.DATABASE_NAME,
                    user: serverEnv.DATABASE_USER,
                    password: serverEnv.DATABASE_PASSWORD,
                    max: 5,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 2000,
                    ssl: serverEnv.isProduction && serverEnv.PGSSLMODE !== "disable"
                        ? { rejectUnauthorized: false }
                        : false,
                });
            }

            this.initialized = true;
            Logger.info("plugins", "Vector store service initialized successfully");
        } catch (error) {
            Logger.error("Vector store initialization failed", error as Error);
            throw error;
        }
    }

    /**
     * Index a document
     *
     * @param content document content in markdown format
     * @param metadata document metadata
     */
    public async indexDocument(
        content: string,
        metadata: Record<string, any>
    ): Promise<void> {
        const teamId = metadata.teamId;
        const settings = await this.getTeamSettings(teamId);
        const vectorStore = await this.getVectorStore(settings);

        try {
            const chunkSize = settings.RAG_CHUNK_SIZE || 1000;
            const chunkOverlap = settings.RAG_CHUNK_OVERLAP || 200;

            const textSplitter = RecursiveCharacterTextSplitter.fromLanguage(
                "markdown",
                {
                    chunkSize,
                    chunkOverlap,
                }
            );

            // Split document into chunks
            const docs = await textSplitter.splitDocuments([
                {
                    pageContent: content,
                    metadata,
                },
            ]);

            // Prepend title to each chunk if available in metadata
            if (metadata.documentTitle) {
                for (const doc of docs) {
                    doc.pageContent = `# ${metadata.documentTitle}\n\n${doc.pageContent}`;
                }
            }

            // Add to vector store
            await vectorStore.addDocuments(docs);

            Logger.debug("plugins", `Indexed document: ${metadata.documentId}`, {
                chunks: docs.length,
            });
        } catch (error) {
            Logger.error("Failed to index document", error as Error);
            throw error;
        }
    }

    /**
     * Delete document from vector store
     *
     * @param documentId document ID
     */
    public async deleteDocument(documentId: string): Promise<void> {
        // Deletion relies on raw SQL and metadata, doesn't need specific embeddings settings
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            // Delete all chunks with this document ID
            await sequelize.query(
                `DELETE FROM rag_vectors WHERE metadata @> :metadata`,
                {
                    replacements: { metadata: JSON.stringify({ documentId }) },
                    type: QueryTypes.DELETE,
                }
            );

            Logger.debug("plugins", `Deleted document from vector store: ${documentId}`);
        } catch (error) {
            Logger.error("Failed to delete document", error as Error);
            throw error;
        }
    }

    /**
     * Find document metadata by ID
     * 
     * @param documentId document ID
     */
    public async findDocumentMetadata(documentId: string): Promise<Record<string, any> | null> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const result = await sequelize.query(
                `SELECT metadata FROM rag_vectors WHERE metadata @> :metadata LIMIT 1`,
                {
                    replacements: { metadata: JSON.stringify({ documentId }) },
                    type: QueryTypes.SELECT,
                }
            );

            if (result.length === 0) {
                return null;
            }

            return (result[0] as any).metadata;
        } catch (error) {
            Logger.error("Failed to find document metadata", error as Error);
            throw error;
        }
    }

    /**
     * Search for similar documents
     *
     * @param query search query
     * @param k number of results to return
     * @param filter optional metadata filter (can contain teamId)
     */
    public async similaritySearch(
        query: string,
        k: number = 10,
        filter?: Record<string, unknown>
    ): Promise<LangChainDocument[]> {
        // Extract teamId from filter if possible to load settings
        let settings = {};
        if (filter && typeof filter.teamId === 'string') {
             settings = await this.getTeamSettings(filter.teamId);
        }

        const vectorStore = await this.getVectorStore(settings);

        try {
            const results = await vectorStore.similaritySearch(query, k, filter);
            return results;
        } catch (error) {
            Logger.error("Failed to perform similarity search", error as Error);
            throw error;
        }
    }

    /**
     * Search for similar documents with scores
     *
     * @param query search query
     * @param k number of results to return
     * @param filter optional metadata filter (can contain teamId)
     * @returns similar documents with similarity scores
     */
    public async similaritySearchWithScore(
        query: string,
        k: number = 10,
        filter?: Record<string, unknown>
    ): Promise<[LangChainDocument, number][]> {
        // Extract teamId from filter if possible to load settings
        // If teamId is not in filter, we might default to env settings
        // Ideally the caller should pass teamId
        let settings = {};
        if (filter && typeof filter.teamId === 'string') {
             settings = await this.getTeamSettings(filter.teamId);
        }

        const vectorStore = await this.getVectorStore(settings);
        const embeddings = await this.getEmbeddings(settings);

        try {
            const queryVector = await embeddings.embedQuery(query);
            const results =
                await vectorStore.similaritySearchVectorWithScore(queryVector, k, filter);
            return results;
        } catch (error) {
            Logger.error("Failed to perform similarity search", error as Error);
            throw error;
        }
    }

    /**
     * Cleanup resources
     */
    public async cleanup(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
        this.initialized = false;
        Logger.info("plugins", "Vector store cleaned up");
    }
}
