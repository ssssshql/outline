import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import Logger from "@server/logging/Logger";
import Integration from "@server/models/Integration";
import { IntegrationService, IntegrationType } from "@shared/types";
import { VectorStoreService } from "./VectorStoreService";

/**
 * Service for RAG-based chat
 */
export class ChatService {
    private static instance: ChatService;
    private vectorStore: VectorStoreService;

    private constructor() {
        this.vectorStore = VectorStoreService.getInstance();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ChatService {
        if (!ChatService.instance) {
            ChatService.instance = new ChatService();
        }
        return ChatService.instance;
    }

    /**
     * Get chat model based on settings
     */
    private async getChatModel(settings: Record<string, any> = {}): Promise<ChatOpenAI> {
        const apiKey = settings.RAG_CHAT_API_KEY || settings.RAG_OPENAI_API_KEY;
        const baseURL = settings.RAG_CHAT_BASE_URL || settings.RAG_OPENAI_BASE_URL;
        const model = settings.RAG_CHAT_MODEL;

        if (!apiKey) {
            throw new Error("Chat API Key not configured");
        }

        return new ChatOpenAI({
            apiKey,
            model,
            temperature: 0.1,
            modelKwargs: {
                thinking: {
                    type: "disabled",
                },
            },
            configuration: {
                baseURL: baseURL || undefined,
            },
            maxRetries: 1,
        });
    }

    /**
     * Get settings for a team
     */
    private async getTeamSettings(teamId?: string): Promise<Record<string, any>> {
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
     * Stream answer to a question using RAG
     *
     * @param question user question
     * @param k number of documents to retrieve
     * @param history chat history
     * @param collectionIds optional collection IDs to filter by
     * @returns async generator of answer chunks
     */
    public async *streamAnswer(
        question: string,
        k?: number,
        history: Array<{ role: "user" | "assistant"; content: string }> = [],
        collectionIds?: string[],
        teamId?: string
    ): AsyncGenerator<{
        type: "sources" | "chunk" | "done";
        data?: any;
    }> {
        try {
            // Load settings first
            const settings = await this.getTeamSettings(teamId);
            const effectiveK = k || settings.RAG_RETRIEVAL_K || 10;

            // Retrieve relevant documents
            Logger.debug("plugins", `RAG: Retrieving documents for query: ${question.substring(0, 50)}...`);
            
            const filter = collectionIds && collectionIds.length > 0 ? {
                collectionId: { $in: collectionIds }
            } : undefined;
            
            const searchFilter = {
                ...filter,
                ...(teamId ? { teamId } : {})
            };

            let retrievedDocs =
                await this.vectorStore.similaritySearchWithScore(question, effectiveK, searchFilter);

            Logger.debug("plugins", `RAG: Retrieved ${retrievedDocs.length} documents`);

            // Filter by score threshold (lower score is better for distance-based metrics)
            const SCORE_THRESHOLD = settings.RAG_SCORE_THRESHOLD !== undefined ? Number(settings.RAG_SCORE_THRESHOLD) : 0.4;
            retrievedDocs = retrievedDocs.filter(([, score]) => score < SCORE_THRESHOLD);

            // Double-check collection filter (safeguard against vector store ignoring filter)
            if (collectionIds && collectionIds.length > 0) {
                retrievedDocs = retrievedDocs.filter(([doc]) => {
                    const docCollectionId = doc.metadata.collectionId as string;
                    return collectionIds.includes(docCollectionId);
                });
            }

            // Yield sources first
            const sources = retrievedDocs.map(([doc, score]) => ({
                content: doc.pageContent,
                metadata: doc.metadata,
                score,
            }));

            yield {
                type: "sources",
                data: sources,
            };

            if (retrievedDocs.length === 0) {
                yield {
                    type: "chunk",
                    data: "rag.no_relevant_documents",
                };
                yield {
                    type: "done",
                };
                return;
            }

            // Load settings and initialize chat model
            Logger.debug("plugins", "RAG: Initializing chat model");
            // Settings already loaded at the beginning
            const chatModel = await this.getChatModel(settings);

            // Construct context from retrieved documents
            const context = retrievedDocs
                .map(([doc]) => doc.pageContent)
                .join("\n\n---\n\n");

            // Create messages for the chat model
            const messages = [
                new SystemMessage(
                    `你是Outline知识库的智能AI助手。
使用以下上下文回答用户的问题。
如果答案不在上下文中，就说你不知道，不要试图编造答案。
保持答案简洁明了。

重要提示：
1. 上下文包含Markdown格式的文本和图片链接。
2. 请直接输出Markdown格式的回答，不要使用代码块（\`\`\`）包裹整个回答。
3. 如果引用了上下文中的图片，请保留图片的原始Markdown格式（如 ![]()），确保图片能正常显示。

上下文:
${context}`
                ),
                ...history.map((msg) =>
                    msg.role === "user"
                        ? new HumanMessage(msg.content)
                        : new AIMessage(msg.content)
                ),
                new HumanMessage(question),
            ];

            // Stream response
            Logger.debug("plugins", "RAG: Streaming response from LLM");
            const stream = await chatModel.stream(messages);

            let chunkCount = 0;
            for await (const chunk of stream) {
                chunkCount++;
                // Log the first few chunks to debug content
                if (chunkCount <= 3) {
                    Logger.debug("plugins", `RAG: Received chunk ${chunkCount}`, {
                        content: chunk.content,
                        type: typeof chunk.content,
                        additional_kwargs: chunk.additional_kwargs,
                    });
                }

                if (chunk.content) {
                    yield {
                        type: "chunk",
                        data: chunk.content,
                    };
                } else if (chunkCount === 1) {
                     Logger.warn("RAG: First chunk has no content");
                }
            }
            
            Logger.debug("plugins", `RAG: LLM stream finished. Total chunks: ${chunkCount}`);

            yield {
                type: "done",
            };
        } catch (error) {
            Logger.error("RAG streamAnswer failed", error as Error);
            throw error;
        }
    }
}
