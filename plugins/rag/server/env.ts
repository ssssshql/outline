import { IsOptional, IsUrl, IsInt, Min, Max } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class RAGPluginEnvironment extends Environment {
    /**
     * OpenAI API key for embeddings and chat
     */
    @IsOptional()
    public RAG_OPENAI_API_KEY = this.toOptionalString(
        environment.RAG_OPENAI_API_KEY
    );

    /**
     * OpenAI API base URL (for custom endpoints like SiliconFlow)
     */
    @IsOptional()
    @IsUrl({
        require_tld: false,
        allow_underscores: true,
    })
    public RAG_OPENAI_BASE_URL = this.toOptionalString(
        environment.RAG_OPENAI_BASE_URL
    );

    /**
     * Embedding model name
     */
    public RAG_EMBEDDING_MODEL =
        environment.RAG_EMBEDDING_MODEL ?? "BAAI/bge-m3";

    /**
     * Embedding dimensions
     */
    @IsInt()
    @Min(128)
    @Max(4096)
    public RAG_EMBEDDING_DIMENSIONS = this.toOptionalNumber(
        environment.RAG_EMBEDDING_DIMENSIONS ?? "1024"
    ) ?? 1024;

    /**
     * Chat model name
     */
    public RAG_CHAT_MODEL = environment.RAG_CHAT_MODEL ?? "gpt-3.5-turbo";

    /**
     * Chat model API key (if different from embedding)
     */
    @IsOptional()
    public RAG_CHAT_API_KEY = this.toOptionalString(
        environment.RAG_CHAT_API_KEY
    );

    /**
     * Chat model base URL (if different from embedding)
     */
    @IsOptional()
    @IsUrl({
        require_tld: false,
        allow_underscores: true,
    })
    public RAG_CHAT_BASE_URL = this.toOptionalString(
        environment.RAG_CHAT_BASE_URL
    );

    /**
     * Vector store table name
     */
    public RAG_TABLE_NAME = environment.RAG_TABLE_NAME ?? "rag_vectors";

    /**
     * Collection table name
     */
    public RAG_COLLECTION_TABLE_NAME =
        environment.RAG_COLLECTION_TABLE_NAME ?? "rag_collections";

    /**
     * Text chunk size for splitting documents
     */
    @IsInt()
    @Min(100)
    @Max(2000)
    public RAG_CHUNK_SIZE = this.toOptionalNumber(
        environment.RAG_CHUNK_SIZE ?? "500"
    ) ?? 500;

    /**
     * Text chunk overlap
     */
    @IsInt()
    @Min(0)
    @Max(500)
    public RAG_CHUNK_OVERLAP = this.toOptionalNumber(
        environment.RAG_CHUNK_OVERLAP ?? "50"
    ) ?? 50;

    /**
     * Number of similar documents to retrieve
     */
    @IsInt()
    @Min(1)
    @Max(20)
    public RAG_RETRIEVAL_K = this.toOptionalNumber(environment.RAG_RETRIEVAL_K ?? "3") ?? 3;
}

export default new RAGPluginEnvironment();
