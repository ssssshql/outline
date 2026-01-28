import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import Logger from "@server/logging/Logger";
import { VectorStoreService } from "./VectorStoreService";
import env from "./env";

/**
 * Service for RAG-based chat
 */
export class ChatService {
    private static instance: ChatService;
    private chatModel: ChatOpenAI | null = null;
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
     * Initialize chat model
     */
    private initializeChatModel(): void {
        if (this.chatModel) {
            return;
        }

        const apiKey = env.RAG_CHAT_API_KEY || env.RAG_OPENAI_API_KEY;
        const baseURL = env.RAG_CHAT_BASE_URL || env.RAG_OPENAI_BASE_URL;

        this.chatModel = new ChatOpenAI({
            apiKey,
            model: env.RAG_CHAT_MODEL,
            temperature: 0.7,
            modelKwargs: {
                thinking: {
                    type: "disabled",
                },
            },
            configuration: {
                baseURL: baseURL || undefined,
            },
            
        });
    }

    /**
     * Answer a question using RAG
     *
     * @param question user question
     * @param k number of documents to retrieve
     * @returns answer with source documents
     */
    public async answerQuestion(
        question: string,
        k: number = env.RAG_RETRIEVAL_K,
        history: Array<{ role: "user" | "assistant"; content: string }> = []
    ): Promise<{
        answer: string;
        sources: Array<{
            content: string;
            metadata: Record<string, any>;
            score: number;
        }>;
    }> {
        try {
            this.initializeChatModel();

            if (!this.chatModel) {
                throw new Error("Chat model not initialized");
            }

            // Retrieve relevant documents
            const retrievedDocs =
                await this.vectorStore.similaritySearchWithScore(question, k);

            if (retrievedDocs.length === 0) {
                return {
                    answer: "抱歉，我在知识库中没有找到相关信息来回答您的问题。",
                    sources: [],
                };
            }

            // Build context from retrieved documents
            const context = retrievedDocs
                .map(([doc], index) => `[文档 ${index + 1}]\n${doc.pageContent}`)
                .join("\n\n");

            // Build system prompt
            const systemPrompt = `你是一个专业的助手，你的任务是根据提供的上下文回答用户的问题。

规则：
1. 只使用提供的上下文信息来回答问题
2. 如果上下文中没有相关信息，请明确告知用户
3. 回答要准确、简洁、有条理
4. 可以引用具体的文档内容来支持你的回答

上下文信息：
${context}`;

            // Generate answer
            const historyMessages = history.map((msg) => {
                if (msg.role === "user") {
                    return new HumanMessage(msg.content);
                } else {
                    return new AIMessage(msg.content);
                }
            });

            const messages = [
                new SystemMessage(systemPrompt),
                ...historyMessages,
                new HumanMessage(question),
            ];

            const response = await this.chatModel.invoke(messages);

            // Format sources
            const sources = retrievedDocs.map(([doc, score]) => ({
                content: doc.pageContent,
                metadata: doc.metadata,
                score,
            }));

            return {
                answer: response.content as string,
                sources,
            };
        } catch (error) {
            Logger.error("Failed to answer question", error as Error);
            throw error;
        }
    }

    /**
     * Stream answer to a question using RAG
     *
     * @param question user question
     * @param k number of documents to retrieve
     * @returns async generator of answer chunks
     */
    public async *streamAnswer(
        question: string,
        k: number = env.RAG_RETRIEVAL_K,
        history: Array<{ role: "user" | "assistant"; content: string }> = []
    ): AsyncGenerator<{
        type: "sources" | "chunk" | "done";
        data?: any;
    }> {
        try {
            this.initializeChatModel();

            if (!this.chatModel) {
                throw new Error("Chat model not initialized");
            }

            // Retrieve relevant documents
            const retrievedDocs =
                await this.vectorStore.similaritySearchWithScore(question, k);

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
                    data: "抱歉，我在知识库中没有找到相关信息来回答您的问题。",
                };
                yield { type: "done" };
                return;
            }

            // Build context
            const context = retrievedDocs
                .map(([doc], index) => `[文档 ${index + 1}]\n${doc.pageContent}`)
                .join("\n\n");

            const systemPrompt = `你是一个专业的助手，你的任务是根据提供的上下文回答用户的问题。

规则：
1. 只使用提供的上下文信息来回答问题
2. 如果上下文中没有相关信息，请明确告知用户
3. 回答要准确、简洁、有条理
4. 可以引用具体的文档内容来支持你的回答

上下文信息：
${context}`;

            const historyMessages = history.map((msg) => {
                if (msg.role === "user") {
                    return new HumanMessage(msg.content);
                } else {
                    return new AIMessage(msg.content);
                }
            });

            const messages = [
                new SystemMessage(systemPrompt),
                ...historyMessages,
                new HumanMessage(question),
            ];

            // Stream response
            const stream = await this.chatModel.stream(messages);

            for await (const chunk of stream) {
                yield {
                    type: "chunk",
                    data: chunk.content,
                };
            }

            yield { type: "done" };
        } catch (error) {
            Logger.error("Failed to stream answer", error as Error);
            throw error;
        }
    }
}
