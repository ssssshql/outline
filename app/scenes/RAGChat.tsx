import { AnimatePresence } from "framer-motion";
import uniqBy from "lodash/uniqBy";
import markdownit from "markdown-it";
import { observer } from "mobx-react";
import {
  WarningIcon,
  SearchIcon,
  MoreIcon,
  CloseIcon,
  RestoreIcon,
  DocumentIcon,
} from "outline-icons";
import * as React from "react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { useTheme, keyframes } from "styled-components";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import { ArrowUpIcon, ArrowLeftIcon } from "~/components/Icons/ArrowIcon";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuButton,
} from "~/components/primitives/Menu";
import SidebarLayout from "~/scenes/Document/components/SidebarLayout";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    content: string;
    metadata: Record<string, unknown>;
    score: number;
  }>;
}

interface IndexedDocument {
  documentId: string;
  documentTitle: string;
  chunks: number;
  updatedAt?: string;
  status: "indexed" | "indexing" | "pending" | "failed" | "retrying";
  error?: string;
}

interface DocumentChunk {
  index: number;
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

function RAGChat() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [documents, setDocuments] = useState<{
    indexed: IndexedDocument[];
    indexing: IndexedDocument[];
  } | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize markdown-it
  const md = useMemo(() => {
    return markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true,
    });
  }, []);

  const scrollToBottom = () => {
    // Only scroll if we are near the bottom or it's a new message
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fetchDocuments = useCallback(async (): Promise<void> => {
    try {
      const response = await client.post<{
        data: {
          indexed: IndexedDocument[];
          indexing: IndexedDocument[];
        };
      }>("/rag.documents", {});
      setDocuments(response.data);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }
  }, []);

  const fetchChunks = useCallback(async (documentId: string): Promise<void> => {
    try {
      const response = await client.post<{
        data: {
          documentId: string;
          chunks: DocumentChunk[];
        };
      }>("/rag.document.chunks", { documentId });
      setChunks(response.data.chunks);
      setSelectedDocument(documentId);
    } catch (error) {
      console.error("Failed to fetch chunks:", error);
      toast.error(t("Failed to fetch document chunks"));
    }
  }, [t]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (showDocuments && !selectedDocument) {
      void fetchDocuments();
      interval = setInterval(() => {
        void fetchDocuments();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDocuments, selectedDocument, fetchDocuments]);

  const handleIndexAll = async (): Promise<void> => {
    if (isIndexing) {
      return;
    }

    try {
      setIsIndexing(true);
      toast.info(t("Starting document indexing..."));

      const response = await client.post<{
        data: {
          total: number;
          queued: number;
          queuedDocuments: Array<{ id: string; title: string }>;
        };
      }>("/rag.indexAll", {
        force: true,
      });

      const { total, queued, queuedDocuments } = response.data;
      
      // Optimistic update
      if (queuedDocuments && queuedDocuments.length > 0) {
        setDocuments((prev) => {
          const existingIds = new Set(prev?.indexing.map((d) => d.documentId));
          const newDocs = queuedDocuments
            .filter((d) => !existingIds.has(d.id))
            .map((d) => ({
              documentId: d.id,
              documentTitle: d.title,
              chunks: 0,
              status: "indexing" as const,
            }));

          return {
            indexed: prev?.indexed || [],
            indexing: [...(prev?.indexing || []), ...newDocs],
          };
        });
      }

      toast.success(
        t("Queued: {{total}} documents total, {{queued}} queued. Processing in background...", { total, queued })
      );

      if (showDocuments) {
        void fetchDocuments();
      }
    } catch (error) {
      toast.error(t("Indexing failed: {{error}}", { error: (error as Error).message }));
    } finally {
      setIsIndexing(false);
    }
  };

  const handleShowDocuments = async () => {
    setShowDocuments(true);
    setSelectedDocument(null);
    setChunks([]);
    await fetchDocuments();
  };

  const handleCloseDocuments = () => {
    setShowDocuments(false);
    setSelectedDocument(null);
    setChunks([]);
  };

  const handleDocumentClick = async (doc: IndexedDocument) => {
    if (doc.status === "indexed") {
      await fetchChunks(doc.documentId);
    }
  };

  const handleBackToList = () => {
    setSelectedDocument(null);
    setChunks([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || isLoading) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        role: "assistant",
        content: "",
        sources: [],
      },
    ]);
    setInput("");
    setIsLoading(true);

    const assistantMessageIndex = messages.length + 1;

    // Prepare history (last 10 messages)
    const history = messages.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const csrfToken = document.cookie
        .split("; ")
        .find((row) => row.startsWith("csrfToken="))
        ?.split("=")[1];

      const response = await fetch("/api/rag.chat.stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          question: userMessage.content,
          k: 12,
          history,
        }),
      });

      if (!response.ok) {
        throw new Error("Stream request failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No reader available");
      }

      let accumulatedContent = "";
      let sources: Array<{
        content: string;
        metadata: Record<string, unknown>;
        score: number;
      }> = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "sources") {
                const rawSources: typeof sources = data.data;
                // Filter by score (distance < 0.6) to remove irrelevant results
                // Deduplicate by documentId to show unique documents only
                sources = uniqBy(
                  rawSources.filter((s) => s.score < 0.6),
                  (s) => s.metadata.documentId as string
                ).slice(0, 5);
                // Note: We intentionally DO NOT update state here.
                // We want sources to appear only after the message is complete.
              } else if (data.type === "chunk") {
                accumulatedContent += data.data;

                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[assistantMessageIndex] = {
                    role: "assistant",
                    content: accumulatedContent,
                    sources: [], // Still hide sources
                  };
                  return newMessages;
                });
              } else if (data.type === "done") {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[assistantMessageIndex] = {
                    role: "assistant",
                    content: accumulatedContent,
                    sources, // Now show sources
                  };
                  return newMessages;
                });
              }
            } catch (parseError) {
              console.error("Failed to parse SSE data:", parseError);
            }
          }
        }
      }
    } catch (error) {
      setMessages((prev) => prev.slice(0, -1));
      toast.error(error instanceof Error ? error.message : t("Failed to send message"));
    } finally {
      setIsLoading(false);
      // Re-focus input after response
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <Wrapper>
      <MainContent>
        <Header>
          <HeaderLeft>
            <HeaderTitle>{t("AI Knowledge Assistant")}</HeaderTitle>
          </HeaderLeft>
          <HeaderActions>
            <IconButton
              onClick={() => setShowDocuments(!showDocuments)}
              title={showDocuments ? t("Hide knowledge base") : t("Show knowledge base")}
              $active={showDocuments}
            >
              {showDocuments ? <CloseIcon size={24} /> : <SearchIcon size={24} />}
            </IconButton>
            <Menu>
              <MenuTrigger>
                <IconButton as="span">
                  <MoreIcon size={24} />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuButton
                  onClick={() => void handleIndexAll()}
                  disabled={isIndexing}
                  icon={<RestoreIcon />}
                  label={isIndexing ? t("Indexing...") : t("Re-index all")}
                />
              </MenuContent>
            </Menu>
          </HeaderActions>
        </Header>

        <ChatArea>
          {messages.length === 0 ? (
            <EmptyState>
              <EmptyIconWrapper>
                <SearchIcon size={32} />
              </EmptyIconWrapper>
              <EmptyTitle>{t("Start asking")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "You can ask about team documents, project plans, or details of any indexed content."
                )}
              </EmptyDescription>
            </EmptyState>
          ) : (
            <MessageList>
              {messages.map((message, index) => (
                <MessageItem key={index} $isUser={message.role === "user"}>
                  {message.role === "assistant" && (
                    <Avatar>
                      <img
                        src="/images/icon-512.png"
                        alt="AI"
                        onError={(e) => {
                          // Fallback if image fails
                          e.currentTarget.style.display = "none";
                          e.currentTarget.parentElement!.style.backgroundColor =
                            "#E5E7EB";
                        }}
                      />
                    </Avatar>
                  )}

                  <MessageContent $isUser={message.role === "user"}>
                    {message.role === "assistant" ? (
                      <>
                        {message.content ? (
                          <MarkdownWrapper
                            dangerouslySetInnerHTML={{
                              __html: md.render(message.content),
                            }}
                          />
                        ) : (
                          <TypingIndicator>
                            <span />
                            <span />
                            <span />
                          </TypingIndicator>
                        )}
                        {message.sources && message.sources.length > 0 && (
                          <SourcesContainer>
                            <SourcesLabel>{t("References")}</SourcesLabel>
                            <SourcesGrid>
                              {message.sources.map((source, idx) => (
                                <SourceChip
                                  key={idx}
                                  href={`/doc/${source.metadata.documentId}`}
                                  target="_blank"
                                >
                                  <DocumentIcon size={12} />
                                  <span>
                                    {source.metadata.documentTitle ||
                                      t("Untitled document")}
                                  </span>
                                </SourceChip>
                              ))}
                            </SourcesGrid>
                          </SourcesContainer>
                        )}
                      </>
                    ) : (
                      <UserBubble>{message.content}</UserBubble>
                    )}
                  </MessageContent>
                </MessageItem>
              ))}
              <div ref={messagesEndRef} style={{ height: 20 }} />
            </MessageList>
          )}
        </ChatArea>

        <InputContainer>
          <InputWrapper onSubmit={handleSubmit}>
            <StyledInput
              ref={inputRef}
              type="text"
              placeholder={t("Ask something...")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <SendButton type="submit" disabled={!input.trim() || isLoading}>
              <ArrowUpIcon size={18} />
            </SendButton>
          </InputWrapper>
        </InputContainer>
      </MainContent>

      <AnimatePresence>
        {showDocuments && (
          <SidebarLayout
            title={
              selectedDocument ? (
                <Flex align="center" gap={8}>
                  <ModalBackBtn onClick={handleBackToList}>
                    <ArrowLeftIcon size={20} />
                  </ModalBackBtn>
                  {t("Document details")}
                </Flex>
              ) : (
                <span style={{ fontWeight: 600 }}>{t("Knowledge base index")}</span>
              )
            }
            onClose={handleCloseDocuments}
          >
            {selectedDocument ? (
              <ChunksGrid>
                {chunks.length > 0 ? (
                  chunks.map((chunk) => (
                    <ChunkCard key={chunk.id}>
                      <ChunkHeader>
                        <ChunkIndex>#{chunk.index}</ChunkIndex>
                        <ChunkId>{chunk.id.substring(0, 8)}</ChunkId>
                      </ChunkHeader>
                      <ChunkText>{chunk.content}</ChunkText>
                    </ChunkCard>
                  ))
                ) : (
                  <LoadingState>{t("Loading...")}</LoadingState>
                )}
              </ChunksGrid>
            ) : (
              <>
                {documents?.indexing && documents.indexing.length > 0 && (
                  <DocSection>
                    <SectionLabel>{t("In progress / Failed")}</SectionLabel>
                    <DocList>
                      {documents.indexing.map((doc) => {
                        const isFailed = doc.status === "failed";
                        const isRetrying = doc.status === "retrying";
                        return (
                          <DocItem key={doc.documentId} $disabled={!isFailed}>
                            <DocIcon
                              $isError={isFailed}
                              $isWarning={isRetrying}
                            >
                              {isFailed ? (
                                <WarningIcon size={14} />
                              ) : (
                                <RestoreIcon size={14} className="spin" />
                              )}
                            </DocIcon>
                            <DocInfo>
                              <DocTitle>{doc.documentTitle}</DocTitle>
                              <DocStatus
                                $isError={isFailed}
                                $isWarning={isRetrying}
                              >
                                {isFailed
                                  ? t("Indexing failed")
                                  : isRetrying
                                  ? t("Retrying...")
                                  : t("Indexing...")}
                              </DocStatus>
                              {isFailed && doc.error && (
                                <DocError title={doc.error}>
                                  {doc.error}
                                </DocError>
                              )}
                            </DocInfo>
                          </DocItem>
                        );
                      })}
                    </DocList>
                  </DocSection>
                )}

                {documents?.indexed && documents.indexed.length > 0 ? (
                  <DocSection>
                    <SectionLabel>
                      {t("Indexed")} ({documents.indexed.length})
                    </SectionLabel>
                    <DocList>
                      {documents.indexed.map((doc) => (
                        <DocItem
                          key={doc.documentId}
                          onClick={() => handleDocumentClick(doc)}
                        >
                          <DocIcon>
                            <DocumentIcon size={14} />
                          </DocIcon>
                          <DocInfo>
                            <DocTitle>{doc.documentTitle}</DocTitle>
                            <DocMeta>
                              {doc.chunks} {t("chunks")} •{" "}
                              {new Date(
                                doc.updatedAt || ""
                              ).toLocaleDateString(i18n.language)}
                            </DocMeta>
                          </DocInfo>
                          <MoreIcon size={14} />
                        </DocItem>
                      ))}
                    </DocList>
                  </DocSection>
                ) : (
                  !documents?.indexing?.length && (
                    <EmptyStateSmall>
                      {t("No indexed documents")}
                    </EmptyStateSmall>
                  )
                )}
              </>
            )}
          </SidebarLayout>
        )}
      </AnimatePresence>
    </Wrapper>
  );
}

// Animations
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

// Styled Components - Minimalist / Claude Style

const Wrapper = styled.div`
  height: 100vh;
  width: 100%;
  background: ${(props) => props.theme.background};
  display: flex;
  flex-direction: row;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: ${(props) => props.theme.text};
`;

const MainContent = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
`;

const Header = styled.div`
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: ${(props) => props.theme.background};
  flex-shrink: 0;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;

  @media (max-width: 768px) {
    padding: 12px 16px;
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const HeaderTitle = styled.h1`
  font-size: 16px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
  margin: 0;
  opacity: 0.8;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 4px;
`;

const MAX_WIDTH = "80%";

const ChatArea = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 20px 15% 40px;
  scroll-behavior: smooth;
  scrollbar-gutter: stable;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: transparent;
  }
  &:hover::-webkit-scrollbar-thumb {
    background: ${(props) => props.theme.slateLight};
    border-radius: 3px;
  }

  @media (max-width: 1200px) {
    padding: 20px 48px 120px;
  }

  @media (max-width: 768px) {
    padding: 16px 16px 100px;
  }
`;

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
  max-width: ${MAX_WIDTH};
  margin: 0 auto;
  width: 100%;
`;

const MessageItem = styled.div<{ $isUser: boolean }>`
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: ${(props) => (props.$isUser ? "flex-end" : "flex-start")};
  animation: ${fadeIn} 0.3s ease-out;

  @media (max-width: 768px) {
    gap: 12px;
  }
`;

const Avatar = styled.div`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  margin-top: 0;
  background: ${(props) => props.theme.slateLight};

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const MessageContent = styled.div<{ $isUser: boolean }>`
  max-width: ${(props) => (props.$isUser ? "80%" : "calc(100% - 48px)")};
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 6px;

  @media (max-width: 768px) {
    max-width: ${(props) => (props.$isUser ? "85%" : "calc(100% - 44px)")};
  }
`;

const UserBubble = styled.div`
  background: ${(props) => props.theme.slateLight};
  color: ${(props) => props.theme.text};
  padding: 10px 16px;
  border-radius: 12px;
  border-bottom-right-radius: 2px;
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-width: 100%;
  overflow-wrap: break-word;
`;

const MarkdownWrapper = styled.div`
  font-size: 15px;
  line-height: 1.7;
  color: ${(props) => props.theme.text};
  overflow-wrap: break-word;

  p {
    margin-top: 0;
    margin-bottom: 12px;
    &:last-child {
      margin-bottom: 0;
    }
  }

  // ... (rest of MarkdownWrapper content kept as is for brevity in this thought, but in actual tool call I will include necessary context or replace the whole block)
  a {
    color: ${(props) => props.theme.accent};
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  code {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 0.9em;
    background: ${(props) => props.theme.codeBackground || "rgba(0,0,0,0.05)"};
    padding: 2px 4px;
    border-radius: 4px;
  }

  pre {
    background: ${(props) => props.theme.codeBackground || "#F8F9FA"};
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    
    code {
      background: transparent;
      padding: 0;
    }
  }

  ul, ol {
    margin: 8px 0 16px 24px;
    padding: 0;
    li {
      margin-bottom: 4px;
    }
  }

  h1, h2, h3, h4 {
    margin: 24px 0 12px;
    font-weight: 600;
    line-height: 1.3;
  }
`;

const SourcesContainer = styled.div`
  margin-top: 8px;
`;

const SourcesLabel = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${(props) => props.theme.textTertiary};
  margin-bottom: 8px;
  font-weight: 600;
`;

const SourcesGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const SourceChip = styled.a`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 16px;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  text-decoration: none;
  transition: all 0.2s;
  max-width: 240px;

  span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &:hover {
    border-color: ${(props) => props.theme.textTertiary};
    background: ${(props) => props.theme.slateLight};
    color: ${(props) => props.theme.text};
  }
`;

const InputContainer = styled.div`
  padding: 24px;
  width: 100%;
  display: flex;
  justify-content: center;
  background: ${(props) => props.theme.background};
  z-index: 20;

  @media (max-width: 768px) {
    padding: 16px;
  }
`;

const InputWrapper = styled.form`
  width: 100%;
  max-width: 768px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border-radius: 24px;
  padding: 8px;
  display: flex;
  align-items: center;
  transition: box-shadow 0.2s, border-color 0.2s;

  &:focus-within {
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    border-color: ${(props) => props.theme.textTertiary};
  }
`;

const StyledInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 16px;
  font-size: 16px;
  color: ${(props) => props.theme.text};
  outline: none;
  min-width: 0; // Fix flex item overflow

  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }
`;

const SendButton = styled.button`
  background: ${(props) => (props.disabled ? props.theme.slateLight : props.theme.text)};
  color: ${(props) => (props.disabled ? props.theme.textTertiary : props.theme.background)};
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  transition: all 0.2s;
  flex-shrink: 0;
  margin-left: 8px;

  &:hover:not(:disabled) {
    transform: scale(1.05);
    background: ${(props) => props.theme.text};
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
  margin-top: 60px; // Reduced margin
  
  @media (max-width: 768px) {
    padding: 24px;
    margin-top: 40px;
  }
`;

const EmptyIconWrapper = styled.div`
  background: ${(props) => props.theme.slateLight};
  width: 64px;
  height: 64px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  color: ${(props) => props.theme.text};
`;

const EmptyTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0 0 8px;
`;

const EmptyDescription = styled.p`
  font-size: 14px;
  max-width: 400px;
  line-height: 1.5;
  margin: 0;
`;

const IconButton = styled.button<{ $isLoading?: boolean; $active?: boolean }>`
  background: ${(props) => (props.$active ? props.theme.slateLight : "transparent")};
  border: none;
  color: ${(props) => (props.$active ? props.theme.text : props.theme.textTertiary)};
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.slateLight};
    color: ${(props) => props.theme.text};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spin {
    animation: ${spin} 1s linear infinite;
  }
`;

const TypingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 0;

  span {
    width: 6px;
    height: 6px;
    background: ${(props) => props.theme.textTertiary};
    border-radius: 50%;
    animation: bounce 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0); }
    40% { transform: scale(1); }
  }
`;

const DrawerHeader = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  display: flex;
  align-items: center;
  justify-content: space-between;

  @media (max-width: 768px) {
    padding: 12px 16px;
  }
`;

const DrawerScrollableContent = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0;
  -webkit-overflow-scrolling: touch;
`;

// Overlay/Modal Components (Reused but simplified)
const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(2px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.2s ease-out;
`;

const ModalCard = styled.div`
  width: 90%;
  max-width: 600px;
  height: 80%;
  background: ${(props) => props.theme.background};
  border-radius: 16px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.divider};
`;

const ModalHeader = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  display: flex;
  align-items: center;
  justify-content: space-between;

  @media (max-width: 768px) {
    padding: 12px 16px;
  }
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ModalBackBtn = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  color: ${(props) => props.theme.text};
  border-radius: 4px;
  &:hover {
    background: ${(props) => props.theme.slateLight};
  }
`;

const ModalCloseBtn = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  color: ${(props) => props.theme.textTertiary};
  padding: 4px;
  border-radius: 4px;
  display: flex;
  &:hover {
    background: ${(props) => props.theme.slateLight};
    color: ${(props) => props.theme.text};
  }
`;

const ModalBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0;
`;

const DocSection = styled.div`
  margin-bottom: 32px;
  padding: 0 20px;
`;

const SectionLabel = styled.div`
  padding: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  margin-bottom: 12px;
`;

const DocList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DocItem = styled.div<{ $disabled?: boolean }>`
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-radius: 8px;
  cursor: ${(props) => (props.$disabled ? "default" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.6 : 1)};
  transition: all 0.2s ease;
  color: ${(props) => props.theme.textSecondary};
  border: 1px solid transparent;

  &:hover {
    background: ${(props) => (props.$disabled ? "transparent" : props.theme.slateLight)};
    color: ${(props) => props.theme.text};
    transform: ${(props) => (props.$disabled ? "none" : "translateX(4px)")};
  }
`;

const DocIcon = styled.div<{ $isError?: boolean; $isWarning?: boolean }>`
  color: ${(props) =>
    props.$isError
      ? props.theme.danger
      : props.$isWarning
      ? props.theme.warning
      : props.theme.textSecondary};
  display: flex;
`;

const DocInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const DocTitle = styled.div`
  font-size: 15px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DocStatus = styled.div<{ $isError?: boolean; $isWarning?: boolean }>`
  font-size: 12px;
  color: ${(props) =>
    props.$isError
      ? props.theme.danger
      : props.$isWarning
      ? props.theme.warning
      : props.theme.textTertiary};
`;

const DocError = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.danger};
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DocMeta = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const EmptyStateSmall = styled.div`
  padding: 40px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
  font-size: 14px;
`;

const LoadingState = styled.div`
  padding: 40px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
`;

const ChunksGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding: 20px;
`;

const ChunkCard = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  padding: 12px;
  background: ${(props) => props.theme.background};
`;

const ChunkHeader = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const ChunkIndex = styled.span`
  font-weight: 600;
`;

const ChunkId = styled.span`
  font-family: monospace;
`;

const ChunkText = styled.div`
  font-size: 13px;
  line-height: 1.5;
  color: ${(props) => props.theme.textSecondary};
  white-space: pre-wrap;
`;

export default observer(RAGChat);
