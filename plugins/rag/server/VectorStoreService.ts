import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document as LangChainDocument } from "@langchain/core/documents";
import { Pool } from "pg";
import { QueryTypes } from "sequelize";
import { sequelize } from "@server/storage/database";
import Logger from "@server/logging/Logger";
import serverEnv from "@server/env";
import env from "./env";

/**
 * Service for managing vector store operations
 */
export class VectorStoreService {
    private static instance: VectorStoreService;
    private vectorStore: PGVectorStore | null = null;
    private embeddings: OpenAIEmbeddings | null = null;
    private textSplitter: RecursiveCharacterTextSplitter | null = null;
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
     * Initialize the vector store
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize embeddings
            this.embeddings = new OpenAIEmbeddings({
                apiKey: env.RAG_OPENAI_API_KEY,
                batchSize: 512,
                model: env.RAG_EMBEDDING_MODEL,
                configuration: env.RAG_OPENAI_BASE_URL
                    ? { baseURL: env.RAG_OPENAI_BASE_URL }
                    : undefined,
            });

            // Initialize text splitter
            this.textSplitter = RecursiveCharacterTextSplitter.fromLanguage(
                "markdown",
                {
                    chunkSize: env.RAG_CHUNK_SIZE,
                    chunkOverlap: env.RAG_CHUNK_OVERLAP,
                }
            );

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

            // Initialize vector store with existing tables
            this.vectorStore = await PGVectorStore.initialize(this.embeddings, {
                pool: this.pool,
                tableName: env.RAG_TABLE_NAME,
                collectionName: "outline_documents",
                collectionTableName: env.RAG_COLLECTION_TABLE_NAME,
                columns: {
                    idColumnName: "id",
                    vectorColumnName: "vector",
                    contentColumnName: "content",
                    metadataColumnName: "metadata",
                },
            });

            // Note: HNSW index is created by migration, no need to create here

            this.initialized = true;
            Logger.info("plugins", "Vector store initialized successfully");
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
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.vectorStore || !this.textSplitter) {
            throw new Error("Vector store not initialized");
        }

        try {
            // Split document into chunks
            const docs = await this.textSplitter.splitDocuments([
                {
                    pageContent: content,
                    metadata,
                },
            ]);

            // Add to vector store
            await this.vectorStore.addDocuments(docs);

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
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.vectorStore) {
            throw new Error("Vector store not initialized");
        }

        try {
            // Delete all chunks with this document ID
            await sequelize.query(
                `DELETE FROM ${env.RAG_TABLE_NAME} WHERE metadata @> :metadata`,
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
                `SELECT metadata FROM ${env.RAG_TABLE_NAME} WHERE metadata @> :metadata LIMIT 1`,
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
     * @returns similar documents with scores
     */
    public async similaritySearch(
        query: string,
        k: number = env.RAG_RETRIEVAL_K
    ): Promise<LangChainDocument[]> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.vectorStore) {
            throw new Error("Vector store not initialized");
        }

        try {
            const results = await this.vectorStore.similaritySearch(query, k);
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
     * @returns similar documents with similarity scores
     */
    public async similaritySearchWithScore(
        query: string,
        k: number = env.RAG_RETRIEVAL_K
    ): Promise<[LangChainDocument, number][]> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.vectorStore || !this.embeddings) {
            throw new Error("Vector store not initialized");
        }

        try {
            const queryVector = await this.embeddings.embedQuery(query);
            const results =
                await this.vectorStore.similaritySearchVectorWithScore(queryVector, k);
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
