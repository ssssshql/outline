import { z } from "zod";

export const RagIndexDocumentSchema = z.object({
    body: z.object({
        content: z.string().min(1, "Content is required"),
        metadata: z.record(z.unknown()).optional(),
    }),
});

export type RagIndexDocumentReq = z.infer<typeof RagIndexDocumentSchema>;

export const RagIndexAllSchema = z.object({
    body: z.object({
        collectionId: z.string().optional(),
        teamId: z.string().optional(),
        force: z.boolean().optional(),
    }),
});

export type RagIndexAllReq = z.infer<typeof RagIndexAllSchema>;

export const RagDeleteDocumentSchema = z.object({
    body: z.object({
        documentId: z.string().min(1, "Document ID is required"),
    }),
});

export type RagDeleteDocumentReq = z.infer<typeof RagDeleteDocumentSchema>;

export const RagSearchSchema = z.object({
    body: z.object({
        query: z.string().min(1, "Query is required"),
        k: z.number().int().min(1).max(20).optional(),
    }),
});

export type RagSearchReq = z.infer<typeof RagSearchSchema>;

export const RagChatSchema = z.object({
    body: z.object({
        question: z.string().min(1, "Question is required"),
        k: z.number().int().min(1).max(20).optional(),
        collectionIds: z.array(z.string()).optional(),
        history: z.array(z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string()
        })).optional(),
    }),
});

export type RagChatReq = z.infer<typeof RagChatSchema>;

export const RagDocumentsSchema = z.object({
    body: z.object({
        teamId: z.string().optional(),
    }),
});

export type RagDocumentsReq = z.infer<typeof RagDocumentsSchema>;

export const RagDocumentChunksSchema = z.object({
    body: z.object({
        documentId: z.string().min(1, "Document ID is required"),
    }),
});

export type RagDocumentChunksReq = z.infer<typeof RagDocumentChunksSchema>;

export const RagGetSettingsSchema = z.object({
    body: z.object({}),
});

export type RagGetSettingsReq = z.infer<typeof RagGetSettingsSchema>;

export const RagSetSettingsSchema = z.object({
    body: z.object({
        RAG_OPENAI_API_KEY: z.string().optional(),
        RAG_OPENAI_BASE_URL: z.string().optional(),
        RAG_EMBEDDING_MODEL: z.string().optional(),
        RAG_EMBEDDING_DIMENSIONS: z.any().optional(),
        RAG_CHAT_MODEL: z.string().optional(),
        RAG_CHAT_API_KEY: z.string().optional(),
        RAG_CHAT_BASE_URL: z.string().optional(),
        RAG_CHUNK_SIZE: z.any().optional(),
        RAG_CHUNK_OVERLAP: z.any().optional(),
        RAG_RETRIEVAL_K: z.any().optional(),
        RAG_SCORE_THRESHOLD: z.any().optional(),
        RAG_TEMPERATURE: z.any().optional(),
    }),
});

export type RagSetSettingsReq = z.infer<typeof RagSetSettingsSchema>;
