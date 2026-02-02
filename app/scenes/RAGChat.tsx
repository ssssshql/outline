import { v4 as uuidv4 } from "uuid";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { AnimatePresence, motion } from "framer-motion";
import uniqBy from "lodash/uniqBy";
import markdownit from "markdown-it";
import { observer } from "mobx-react";
import { transparentize } from "polished";
import {
  WarningIcon,
  SearchIcon,
  MoreIcon,
  CloseIcon,
  RestoreIcon,
  DocumentIcon,
  PlusIcon,
  TrashIcon,
  CommentIcon,
  HistoryIcon,
  SettingsIcon,
  CollectionIcon as SVGCollectionIcon,
} from "outline-icons";
import * as React from "react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useParams } from "react-router-dom";
import { toast } from "sonner";
import styled, { keyframes, css, useTheme } from "styled-components";
import Flex from "~/components/Flex";
import Modal from "~/components/Modal";
import Lightbox from "~/components/Lightbox";
import type { LightboxImage } from "@shared/editor/lib/Lightbox";
import { ArrowUpIcon, ArrowLeftIcon } from "~/components/Icons/ArrowIcon";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuButton,
} from "~/components/primitives/Menu";
import TeamLogo from "~/components/TeamLogo";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Text from "~/components/Text";
import RAGSettingsModal from "./RAGSettingsModal";

interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  sources?: Array<{
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    indices?: number[];
  }>;
}

const STORAGE_KEY = "rag_chat_sessions";

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
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

const TimeSeparator = ({ date }: { date: Date }) => {
  // Format: 1月30日星期五 · AI
  // Note: Assuming 'AI' was intended to be the time or a fixed string. 
  // Given the context of a chat timestamp, displaying the actual time is most functional.
  // We will format as: "M月D日星期X · HH:mm"
  
  const dateStr = date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'long' });
  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <TimeSeparatorContainer>
      <TimeText>
        {`${dateStr} · ${timeStr}`}
      </TimeText>
    </TimeSeparatorContainer>
  );
};

function RAGChat() {
  const history = useHistory();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { collections, dialogs } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const team = useCurrentTeam({ rejectOnEmpty: false });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false); // Default hidden
  const [showSettings, setShowSettings] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  
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
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Smooth Streaming Refs
  const streamTargetRef = useRef("");
  const streamCurrentRef = useRef("");
  const streamSourcesRef = useRef<any[]>([]);
  const streamIntervalRef = useRef<number | null>(null);
  const isStreamDoneRef = useRef(false);

  // Lightbox State
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);

  const toggleCollection = (id: string) => {
    if (id === "") {
      // Clear all
      setSelectedCollectionIds([]);
    } else {
      setSelectedCollectionIds((prev) => {
        if (prev.includes(id)) {
          return prev.filter((i) => i !== id);
        }
        return [...prev, id];
      });
    }
  };

  const currentSelectionLabel = useMemo(() => {
    if (selectedCollectionIds.length === 0) {
      return t("All collections");
    }
    if (selectedCollectionIds.length === 1) {
      const collection = collections.get(selectedCollectionIds[0]);
      return collection?.name || t("Unknown collection");
    }
    return t("{{count}} collections selected", { count: selectedCollectionIds.length });
  }, [selectedCollectionIds, collections, t]);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      setLightboxImage({
        src: img.src,
        alt: img.alt,
        pos: 0,
        source: 'upload', // Default source type
        getElement: () => img,
      } as any);
    }
  }, []);

  // Load history on mount
  useEffect(() => {
    try {
      if (collections.orderedData.length === 0) {
        void collections.fetchNamedPage("list", undefined);
      }

      const stored = localStorage.getItem(STORAGE_KEY);
      let loadedSessions: ChatSession[] = [];

      if (stored) {
        const parsed = JSON.parse(stored);
        
        // Sanitize history: remove empty assistant messages at the end
        parsed.forEach((session: ChatSession) => {
          if (session.messages.length > 0) {
            const lastMsg = session.messages[session.messages.length - 1];
            if (lastMsg.role === "assistant" && !lastMsg.content.trim() && (!lastMsg.sources || lastMsg.sources.length === 0)) {
              session.messages.pop();
            }
          }
        });

        if (parsed.length > 0) {
          // Sort by updatedAt desc
          parsed.sort((a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt);
        }
        loadedSessions = parsed;
        setSessions(loadedSessions);
      }

      // Check URL param
      if (sessionId) {
          const matchedSession = loadedSessions.find(s => s.id === sessionId);
          if (matchedSession) {
             setCurrentSessionId(sessionId);
             setMessages(matchedSession.messages);
             if (window.innerWidth < 768) {
               setShowHistory(false);
             }
             return; 
          }
      }
      
      // If no sessionId in URL OR sessionId not found in storage -> New Chat
      createNewChat();
    } catch (error) {
      // ignore
      createNewChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL to State (handle back/forward navigation)
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setCurrentSessionId(sessionId);
            setMessages(session.messages);
        }
    }
  }, [sessionId, sessions, currentSessionId]);

  // Persist session when messages change (debounced)
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) {
      return;
    }

    const handler = setTimeout(() => {
      setSessions((prev) => {
        const index = prev.findIndex((s) => s.id === currentSessionId);
        if (index === -1) {
          return prev;
        }

        const currentSession = prev[index];
        // Only update if messages changed
        if (JSON.stringify(currentSession.messages) === JSON.stringify(messages)) {
            return prev;
        }

        const updated = {
          ...currentSession,
          messages,
          updatedAt: Date.now(),
        };

        // Update title from first user message if it's "New Chat"
        if (currentSession.title === t("New Chat")) {
          const firstUserMsg = messages.find((m) => m.role === "user");
          if (firstUserMsg) {
            updated.title = firstUserMsg.content.slice(0, 30) || t("New Chat");
          }
        }

        const newSessions = [...prev];
        newSessions[index] = updated;
        newSessions.sort((a, b) => b.updatedAt - a.updatedAt);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSessions));
        return newSessions;
      });
    }, 1000);

    return () => clearTimeout(handler);
  }, [messages, currentSessionId, t]);

  const createNewChat = useCallback(() => {
    if (isLoading) {
      return;
    }
    const newId = uuidv4();
    const newSession: ChatSession = {
      id: newId,
      title: t("New Chat"),
      messages: [],
      updatedAt: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    
    // Update URL
    history.push(`/rag/chat/${newId}`);

    setCurrentSessionId(newId);
    setMessages([]);
    setInput("");
    if (window.innerWidth < 768) {
      setShowHistory(false);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isLoading, t, history]);

  // Handle keyboard shortcuts for history modal
  useEffect(() => {
    if (!showHistory) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setShowHistory(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        createNewChat();
        setShowHistory(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHistory, createNewChat]);

  const selectSession = (id: string) => {
    if (id === currentSessionId || isLoading) {
      return;
    }
    
    history.push(`/rag/chat/${id}`);

    const session = sessions.find((s) => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
      if (window.innerWidth < 768) {
        setShowHistory(false);
      }
    }
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm(t("Are you sure you want to delete this chat?"))) {
        const newSessions = sessions.filter((s) => s.id !== id);
        setSessions(newSessions);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSessions));

        if (currentSessionId === id) {
          if (newSessions.length > 0) {
            selectSession(newSessions[0].id);
          } else {
            createNewChat();
          }
        }
    }
  };

  // Initialize markdown-it
  const md = useMemo(() => {
    const instance = markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true,
    });

    const defaultFence = instance.renderer.rules.fence || function(tokens, idx, options, env, self) {
      const token = tokens[idx];
      const info = token.info ? instance.utils.unescapeAll(token.info).trim() : '';
      let langName = '';
      if (info) {
        langName = info.split(/\s+/g)[0];
      }
      return  '<pre><code class="language-' + langName + '">'
            + instance.utils.escapeHtml(token.content)
            + '</code></pre>\n';
    };

    instance.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const info = token.info ? instance.utils.unescapeAll(token.info).trim() : '';
      const langName = info.split(/\s+/g)[0];

      if (langName === 'mermaid') {
        return `<div class="mermaid-diagram" data-code="${encodeURIComponent(token.content.trim())}"></div>`;
      }

      if (langName === 'error') {
        // Remove the ⚠️ from the content if it's already there to avoid duplication with CSS
        const content = instance.utils.escapeHtml(token.content.trim()).replace(/^⚠️\s*/, '');
        return `<div class="chat-error-message">${content}</div>`;
      }

      return defaultFence(tokens, idx, options, env, self);
    };

    // Wrap tables for horizontal scrolling
    instance.renderer.rules.table_open = (tokens, idx, options, env, self) => {
      return '<div class="table-wrapper">' + self.renderToken(tokens, idx, options);
    };
    instance.renderer.rules.table_close = (tokens, idx, options, env, self) => {
      return self.renderToken(tokens, idx, options) + '</div>';
    };

    return instance;
  }, []);

  // Render Mermaid diagrams
  useEffect(() => {
    const renderMermaid = async () => {
      const nodes = document.querySelectorAll('.mermaid-diagram');
      if (nodes.length === 0) return;

      try {
        const mermaid = (await import("mermaid")).default;
        
        mermaid.initialize({
          startOnLoad: false,
          theme: theme.isDark ? "dark" : "default",
          securityLevel: 'loose',
          fontFamily: "inherit",
        });

        for (const node of nodes) {
          const element = node as HTMLElement;
          const currentTheme = theme.isDark ? "dark" : "light";
          
          if (element.dataset.rendered === "true" && element.dataset.renderTheme === currentTheme) {
            continue;
          }

          const code = decodeURIComponent(element.dataset.code || '');
          if (!code) continue;

          const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          
          // Create a temporary element to render off-screen (similar to shared/editor/extensions/Mermaid.ts)
          // Mermaid needs this to calculate dimensions correctly sometimes
          const renderElement = document.createElement("div");
          renderElement.id = "offscreen-" + id;
          renderElement.style.position = "absolute";
          renderElement.style.left = "-9999px";
          renderElement.style.top = "-9999px";
          document.body.appendChild(renderElement);

          try {
            const { svg } = await mermaid.render(id, code, renderElement);
            element.innerHTML = svg;
            element.dataset.rendered = "true";
            element.dataset.renderTheme = currentTheme;
            element.classList.remove("error");
          } catch (error) {
             console.error("Mermaid error:", error);
             // Don't show error trace to user, just a friendly message or the code block
             element.innerHTML = `<pre class="mermaid-error">${t("Mermaid Syntax Error")}</pre>`;
             element.dataset.rendered = "true";
             element.dataset.renderTheme = currentTheme;
             element.classList.add("error");
          } finally {
            renderElement.remove();
          }
        }
      } catch (err) {
        console.error("Failed to load mermaid", err);
      }
    };

    void renderMermaid();
  }, [messages, theme]);

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
      if (interval) {
        clearInterval(interval);
      }
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

    if (isLoading) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }
      setIsLoading(false);
      return;
    }

    if (!input.trim()) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      createdAt: Date.now(),
    };

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        role: "assistant",
        content: "",
        createdAt: Date.now() + 1,
        sources: [],
      },
    ]);
    setInput("");
    setIsLoading(true);

    const assistantMessageIndex = messages.length + 1;

    // Reset Stream Refs
    streamTargetRef.current = "";
    streamCurrentRef.current = "";
    streamSourcesRef.current = [];
    isStreamDoneRef.current = false;

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
    }

    // Start Smooth Typer
    streamIntervalRef.current = window.setInterval(() => {
      const target = streamTargetRef.current;
      const current = streamCurrentRef.current;

      if (current.length < target.length) {
        const lag = target.length - current.length;
        // Adaptive speed
        const step = lag > 50 ? 5 : lag > 20 ? 2 : 1;
        
        const nextContent = target.substring(0, current.length + step);
        streamCurrentRef.current = nextContent;

        setMessages((prev) => {
          const newMessages = [...prev];
          // Ensure we are updating the correct message
          if (newMessages[assistantMessageIndex]) {
            newMessages[assistantMessageIndex] = {
              ...newMessages[assistantMessageIndex],
              content: nextContent,
              sources: [], // Keep hidden until done
            };
          }
          return newMessages;
        });
      } else if (isStreamDoneRef.current) {
        // Done streaming and typing catch-up
        if (streamIntervalRef.current) {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
        }

        // Final update to show sources
        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages[assistantMessageIndex]) {
            newMessages[assistantMessageIndex] = {
              ...newMessages[assistantMessageIndex],
              content: streamCurrentRef.current,
              sources: streamSourcesRef.current,
            };
          }
          return newMessages;
        });

        setIsLoading(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }, 20); // 50 fps

    // Prepare history (last 10 messages)
    const history = messages.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      const csrfToken = document.cookie
        .split("; ")
        .find((row) => row.startsWith("csrfToken="))
        ?.split("=")[1];

      await fetchEventSource("/api/rag.chat.stream", {
        method: "POST",
        openWhenHidden: true, // Prevent duplicate requests on tab switch
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        body: JSON.stringify({
          question: userMessage.content,
          history,
          collectionIds: selectedCollectionIds.length > 0 ? selectedCollectionIds : undefined,
        }),
        async onopen(response) {
          if (response.ok) {
            return;
          }
          
          let errorMessage = response.statusText;
          try {
            const body = await response.text();
            try {
              const json = JSON.parse(body);
              if (json.message) errorMessage = json.message;
              else if (json.data) errorMessage = json.data;
              else errorMessage = body;
            } catch {
              if (body) errorMessage = body;
            }
          } catch (e) {
            // Ignore body read error
          }
          
          throw new Error(errorMessage || t("Failed to connect: {{status}}", { status: response.status }));
        },
        onmessage(event) {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "sources") {
              const rawSources = data.data;
              
              // 1. Add indices
              const relevantSources = rawSources
                .map((s: any, i: number) => ({ ...s, index: i + 1 }));

              // 2. Group by documentId
              const grouped = relevantSources.reduce((acc: any, source: any) => {
                const docId = source.metadata.documentId as string;
                if (!acc[docId]) {
                  acc[docId] = {
                    ...source,
                    indices: [source.index]
                  };
                } else {
                  acc[docId].indices!.push(source.index);
                }
                return acc;
              }, {});

              // Sort indices
              Object.values(grouped).forEach((group: any) => {
                group.indices?.sort((a: number, b: number) => a - b);
              });

              streamSourcesRef.current = Object.values(grouped).slice(0, 5) as any[];
            } else if (data.type === "chunk") {
              let text = data.data;
              if (text === "rag.no_relevant_documents") {
                text = t("rag.no_relevant_documents");
              }
              streamTargetRef.current += text;
            } else if (data.type === "error") {
              streamTargetRef.current += `\n\n\`\`\`error\n${data.data}\n\`\`\``;
              isStreamDoneRef.current = true;
              streamSourcesRef.current = []; // Clear sources on error
              ctrl.abort(); 
            } else if (data.type === "done") {
              isStreamDoneRef.current = true;
            }
          } catch (parseError) {
            console.error("Failed to parse SSE data:", parseError);
          }
        },
        onerror(err) {
          if (ctrl.signal.aborted) {
            throw err; 
          }
          throw err;
        },
      });
    } catch (error) {
      if (abortControllerRef.current?.signal.aborted) {
        // If aborted manually or by error handler, we just stop.
        return;
      }
      
      const errorMessage = error instanceof Error ? t(error.message) : t("Failed to send message");
      
      // Append error to target so it gets typed out
      streamTargetRef.current += `\n\n\`\`\`error\n${errorMessage}\n\`\`\``;
      isStreamDoneRef.current = true;
      streamSourcesRef.current = []; // Clear sources on error
    } finally {
      // Ensure we mark stream as done so interval cleans up
      isStreamDoneRef.current = true;
    }
  };

  const currentTitle = useMemo(() => {
    const session = sessions.find((s) => s.id === currentSessionId);
    return session?.title || t("New Chat");
  }, [sessions, currentSessionId, t]);

  const filteredSessions = useMemo(() => {
    if (!filterQuery.trim()) {
      return sessions;
    }
    return sessions.filter(s => 
      s.title.toLowerCase().includes(filterQuery.toLowerCase())
    );
  }, [sessions, filterQuery]);

  // --- bold design: "Ethereal Focus" ---
  return (
    <Wrapper>
      {/* Floating Top Bar */}
      <TopBar>
        <TopBarLeft>
          <CurrentChatButton onClick={() => setShowHistory(true)} title={t("View chat history")}>
            <HistoryLabel>{t("History")} /</HistoryLabel>
            <ChatTitle>{currentTitle}</ChatTitle>
            <ChevronIconWrapper>
              <HistoryIcon size={14} />
            </ChevronIconWrapper>
          </CurrentChatButton>
        </TopBarLeft>

        <TopBarRight>
          <GlassIconButton
            onClick={() => setShowDocuments(!showDocuments)}
            title={showDocuments ? t("Hide knowledge base") : t("Show knowledge base")}
            $active={showDocuments}
          >
            {showDocuments ? <CloseIcon size={20} /> : <SearchIcon size={20} />}
          </GlassIconButton>
          
          {user?.isAdmin && (
            <Menu>
              <MenuTrigger>
                <GlassIconButton as="span">
                  <SettingsIcon size={20} />
                </GlassIconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuButton
                  onClick={() => setShowSettings(true)}
                  icon={<SettingsIcon />}
                  label={t("RAG Configuration")}
                />
                <MenuButton
                  onClick={() => {
                    dialogs.openModal({
                      title: t("Confirm Re-index"),
                      content: (
                        <ConfirmationDialog
                          onSubmit={handleIndexAll}
                          submitText={t("Re-index")}
                          savingText={t("Indexing...")}
                        >
                          <Text>
                            {t("Are you sure you want to re-index all documents? This may take a while.")}
                          </Text>
                        </ConfirmationDialog>
                      )
                    });
                  }}
                  disabled={isIndexing}
                  icon={<RestoreIcon />}
                  label={isIndexing ? t("Indexing...") : t("Re-index all")}
                />
              </MenuContent>
            </Menu>
          )}
        </TopBarRight>
      </TopBar>



      {/* Command Center Overlay (History) */}
      <AnimatePresence>
        {showHistory && (
          <CommandCenterOverlay>
            <Backdrop onClick={() => setShowHistory(false)} />
            <CommandCard>
              <CommandHeader>
                <SearchIcon size={18} color="currentColor"/>
                <CommandSearchInput
                  autoFocus
                  placeholder={t("Search or start new chat...")}
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
                <CommandShortcut>Esc</CommandShortcut>
              </CommandHeader>
              
              <CommandList>
                <CommandSectionTitle>{t("Actions")}</CommandSectionTitle>
                <CommandItem
                  $active={false}
                  onClick={() => {
                    createNewChat();
                    setShowHistory(false);
                  }}
                >
                  <CommandIcon $color="primary">
                    <PlusIcon size={16} />
                  </CommandIcon>
                  <CommandContent>
                    <CommandTitle>{t("New Chat")}</CommandTitle>
                    <CommandSubtitle>{t("Start a fresh conversation")}</CommandSubtitle>
                  </CommandContent>
                  <CommandShortcut>Enter</CommandShortcut>
                </CommandItem>

                <CommandSectionTitle>{t("Recent")}</CommandSectionTitle>
                {filteredSessions.length > 0 ? (
                  filteredSessions.map((session) => (
                    <CommandItem
                      key={session.id}
                      $active={session.id === currentSessionId}
                      onClick={() => {
                        selectSession(session.id);
                        setShowHistory(false);
                      }}
                    >
                      <CommandIcon>
                        <CommentIcon size={16} />
                      </CommandIcon>
                      <CommandContent>
                        <CommandTitle>{session.title}</CommandTitle>
                        <CommandSubtitle>
                          {new Date(session.updatedAt).toLocaleDateString(i18n.language, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </CommandSubtitle>
                      </CommandContent>
                      <DeleteAction onClick={(e) => deleteSession(e, session.id)}>
                        <TrashIcon size={14} />
                      </DeleteAction>
                    </CommandItem>
                  ))
                ) : (
                  <EmptySearch>
                    {t("No conversations found")}
                  </EmptySearch>
                )}
              </CommandList>
            </CommandCard>
          </CommandCenterOverlay>
        )}
      </AnimatePresence>

      {/* Knowledge Base Overlay */}
      <AnimatePresence>
        {showDocuments && (
          <DocumentsOverlay
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Backdrop onClick={handleCloseDocuments} />
            <DocumentsPanel
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <DocumentsHeader>
                {selectedDocument ? (
                  <Flex align="center" gap={8}>
                    <ModalBackBtn onClick={handleBackToList}>
                      <ArrowLeftIcon size={24} />
                    </ModalBackBtn>
                    <DocumentsTitle>{t("Document details")}</DocumentsTitle>
                  </Flex>
                ) : (
                  <DocumentsTitle>{t("Knowledge Base")}</DocumentsTitle>
                )}
                <GlassIconButton onClick={handleCloseDocuments}>
                   <CloseIcon size={20} />
                </GlassIconButton>
              </DocumentsHeader>

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
                <ModalScrollArea>
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
                              <DocumentIcon size={16} />
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
                            <MoreIconWrapper>
                              <MoreIcon size={16} color="currentColor" />
                            </MoreIconWrapper>
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
                </ModalScrollArea>
              )}
            </DocumentsPanel>
          </DocumentsOverlay>
        )}
      </AnimatePresence>

      <ContentWrapper>
        <MainContent>
          <ChatScrollArea>
            <ChatContainer>
              {messages.length === 0 ? (
                <div style={{ flex: 1 }} />
              ) : (
                <MessageList>
                  {messages.map((message, index) => {
                    const prevMessage = messages[index - 1];
                    const showTimestamp = !prevMessage || (message.createdAt - (prevMessage.createdAt || 0) > 5 * 60 * 1000);

                    return (
                      <React.Fragment key={index}>
                        {showTimestamp && <TimeSeparator date={new Date(message.createdAt || Date.now())} />}
                        <MessageRow
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          <MessageItem $isUser={message.role === "user"}>
                            {message.role === "assistant" && (
                              <Avatar>
                                {team && (
                                  <TeamLogo model={team} size={32} />
                                )}
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
                                onClick={handleImageClick}
                              />
                                  ) : (
                                    <TypingIndicator>
                                      <span /><span /><span />
                                    </TypingIndicator>
                                  )}
                                  {message.sources && message.sources.length > 0 && (
                                    <SourcesContainer>
                                      <SourcesLabel>{t("References")}</SourcesLabel>
                                      <SourcesGrid>
                                        {message.sources.map((source, idx) => (
                                          <SourceCard
                                            key={idx}
                                            href={`/doc/${source.metadata.documentId}`}
                                            target="_blank"
                                          >
                                            <DocumentIcon size={12} />
                                            <span>
                                              {source.metadata.documentTitle || t("Untitled document")}
                                              {source.indices && source.indices.length > 0 && (
                                                <SourceIndices>
                                                  {source.indices.map(i => `#${i}`).join(" ")}
                                                </SourceIndices>
                                              )}
                                            </span>
                                          </SourceCard>
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
                        </MessageRow>
                      </React.Fragment>
                    );
                  })}
                  <div ref={messagesEndRef} style={{ height: 100 }} />
                </MessageList>
              )}
            </ChatContainer>
          </ChatScrollArea>

          <InputFloatingContainer $isCenter={messages.length === 0}>
            {messages.length === 0 && (
              <HeroEmptyState
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <HeroIcon>
                  {team && (
                    <TeamLogo model={team} style={{ width: 80, height: 80 }} />
                  )}
                </HeroIcon>
                <HeroTitle>{t("How can I help you today?")}</HeroTitle>
                <HeroSubtitle>
                  {t("Ask about project specs, engineering guides, or meeting notes.")}
                </HeroSubtitle>
              </HeroEmptyState>
            )}

            <InputGlassWrapper
                onSubmit={handleSubmit}
                onClick={() => inputRef.current?.focus()}
              >
                <CollectionSelectorWrapper>
                <Menu>
                  <MenuTrigger>
                    <CollectionSelectorButton>
                      <SVGCollectionIcon size={16} />
                      <span>{currentSelectionLabel}</span>
                      <ChevronIconWrapper>
                        <ArrowLeftIcon size={12}/>
                      </ChevronIconWrapper>
                    </CollectionSelectorButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuButton
                      onClick={() => toggleCollection("")}
                      selected={selectedCollectionIds.length === 0}
                      icon={<SVGCollectionIcon />}
                      label={t("All collections")}
                    />
                    {collections.orderedData.map((collection) => (
                      <MenuButton
                        key={collection.id}
                        onClick={(e) => {
                          e.preventDefault();
                          toggleCollection(collection.id);
                        }}
                        selected={selectedCollectionIds.includes(collection.id)}
                        icon={<CollectionIcon collection={collection} />}
                        label={collection.name}
                      />
                    ))}
                  </MenuContent>
                </Menu>
              </CollectionSelectorWrapper>

              <InputRow>
                <StyledInput
                  ref={inputRef}
                  type="text"
                  placeholder={t("Ask anything...")}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isLoading}
                />
                <SendButton type="submit" disabled={!input.trim() && !isLoading}>
                  {isLoading ? (
                    <div className="loading-dot" />
                  ) : (
                    <ArrowUpIcon size={20} />
                  )}
                </SendButton>
              </InputRow>
            </InputGlassWrapper>
          </InputFloatingContainer>
        </MainContent>


      </ContentWrapper>

      {showSettings && (
        <RAGSettingsModal onRequestClose={() => setShowSettings(false)} />
      )}
      
      {lightboxImage && (
        <Lightbox
          images={[lightboxImage]}
          activeImage={lightboxImage}
          onUpdate={(img) => setLightboxImage(img)}
          onClose={() => setLightboxImage(null)}
          readOnly
        />
      )}
    </Wrapper>
  );
}

// --- Bold & Creative Styled Components ---

const scrollbarMixin = css`
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(155, 155, 155, 0.2);
    border-radius: 3px;
    border: 1px solid transparent;
    background-clip: content-box;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: rgba(155, 155, 155, 0.4);
    border: 1px solid transparent;
    background-clip: content-box;
  }
  
  ${(props) => props.theme.isDark && css`
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
    }
    &::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `}
`;

const Wrapper = styled.div`
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  position: relative;
`;

const TopBar = styled.div`
  flex-shrink: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 300;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to bottom, ${(props) => props.theme.background} calc(100% - 20px), ${(props) => transparentize(1, props.theme.background)} 100%);
    backdrop-filter: blur(4px);
    mask-image: linear-gradient(to bottom, black calc(100% - 20px), transparent 100%);
  }
`;

const TopBarLeft = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  margin-right: 16px;
  pointer-events: auto;
`;

const TopBarRight = styled.div`
  display: flex;
  gap: 12px;
  pointer-events: auto;
  flex-shrink: 0;
`;

const CurrentChatButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin-left: -8px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: ${(props) => props.theme.text};
  min-width: 0;
  flex-shrink: 1;

  &:hover {
    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
    color: ${(props) => props.theme.text};
  }
`;

const ChatTitle = styled.span`
  font-weight: 600;
  font-size: 14px;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HistoryLabel = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
  margin-right: 4px;
  font-weight: 500;
`;

const GlassIconButton = styled.button<{ $active?: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  
  background: ${(props) => props.$active ? props.theme.text : "rgba(0,0,0,0.03)"};
  color: ${(props) => props.$active ? props.theme.background : props.theme.text};
  
  ${(props) => props.theme.isDark && `
    background: ${props.$active ? props.theme.text : "rgba(255,255,255,0.05)"};
  `}

  &:hover {
    background: ${(props) => props.$active ? props.theme.text : "rgba(0,0,0,0.08)"};
    transform: scale(1.05);
  }
`;

// Command Center
const CommandCenterOverlay = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
`;

const DocumentsOverlay = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const DocumentsCard = styled(motion.div)`
  position: relative;
  width: 720px;
  max-width: 100%;
  max-height: 85vh;
  background: ${(props) => props.theme.background};
  border-radius: 16px;
  box-shadow: 
    0 24px 48px rgba(0, 0, 0, 0.2), 
    0 0 0 1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 501;
`;

const Backdrop = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  /* backdrop-filter removed for performance */
`;

const CommandCard = styled(motion.div)`
  position: relative;
  width: 600px;
  max-width: 90%;
  max-height: 70vh;
  background: ${(props) => props.theme.background};
  border-radius: 16px;
  box-shadow: 
    0 24px 48px rgba(0, 0, 0, 0.2), 
    0 0 0 1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 501;
`;

const CommandHeader = styled.div`
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  gap: 12px;
`;

const CommandSearchInput = styled.input`
  flex: 1;
  border: none;
  font-size: 18px;
  background: transparent;
  color: ${(props) => props.theme.text};
  outline: none;
  
  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }
`;

const CommandShortcut = styled.kbd`
  font-family: monospace;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: ${(props) => props.theme.slateLight};
  color: ${(props) => props.theme.textTertiary};
  border: 1px solid rgba(0,0,0,0.05);
`;

const CommandList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;
`;

const CommandSectionTitle = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${(props) => props.theme.textTertiary};
  padding: 8px 12px;
  font-weight: 600;
`;

const CommandItem = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s;
  background: ${(props) => (props.$active ? props.theme.slateLight : "transparent")};

  &:hover {
    background: ${(props) => props.theme.slateLight};
  }
`;

const CommandIcon = styled.div<{ $color?: "primary" }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => props.$color === "primary" ? props.theme.text : props.theme.background};
  color: ${(props) => props.$color === "primary" ? props.theme.background : props.theme.textTertiary};
  border: 1px solid ${(props) => props.theme.divider};
`;

const CommandContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const CommandTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
`;

const CommandSubtitle = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// Main Layout

const ContentWrapper = styled.div`
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  overflow: hidden;
`;

const ChatScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-top: 80px;
  padding-bottom: 120px;
  min-height: 0;
  ${scrollbarMixin}
`;

const ChatContainer = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
`;

// Hero Empty State

const HeroEmptyState = styled(motion.div)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
`;

const HeroIcon = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: transparent;
  margin-bottom: 12px;
  box-shadow: 0 20px 40px -10px rgba(0,0,0,0.2);
  overflow: hidden;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const HeroTitle = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: ${(props) => props.theme.text};
  margin-bottom: 12px;
  letter-spacing: -0.02em;
`;

const HeroSubtitle = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textSecondary};
  max-width: 400px;
  line-height: 1.5;
`;

// Messages

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const MessageRow = styled(motion.div)`
  width: 100%;
`;

const MessageItem = styled.div<{ $isUser: boolean }>`
  display: flex;
  gap: 20px;
  flex-direction: row;
  justify-content: ${(props) => (props.$isUser ? "flex-end" : "flex-start")};
`;

const UserBubble = styled.div`
  background: ${(props) => props.theme.slateLight};
  color: ${(props) => props.theme.text};
  padding: 12px 20px;
  border-radius: 20px;
  border-bottom-right-radius: 4px;
  font-size: 14px;
  line-height: 1.6;
  max-width: 100%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.02);
`;

const SourceCard = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 24px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  color: ${(props) => props.theme.textSecondary};
  text-decoration: none;
  font-size: 13px;
  transition: all 0.2s;
  
  &:hover {
    border-color: ${(props) => props.theme.brand.dark};
    color: ${(props) => props.theme.brand.dark};
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  }
`;

const SourceIndices = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.slateLight};
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 8px;
  vertical-align: middle;
  border: 1px solid ${(props) => props.theme.divider};
`;

// Input

const InputFloatingContainer = styled.div<{ $isCenter?: boolean }>`
  flex-shrink: 0;
  padding: 24px;
  display: flex;
  justify-content: center;
  z-index: 10;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to top, ${(props) => props.theme.background} calc(100% - 20px), ${(props) => transparentize(1, props.theme.background)} 100%);
    backdrop-filter: blur(4px);
    mask-image: linear-gradient(to top, black calc(100% - 20px), transparent 100%);
  }
  
  ${(props) => props.$isCenter && css`
    position: absolute;
    top: 45%;
    left: 0;
    right: 0;
    transform: translateY(-50%);
    background: transparent;
    backdrop-filter: none;
    padding: 0 24px;
    z-index: 20;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  `}
`;

const InputGlassWrapper = styled.form`
  pointer-events: auto;
  width: 100%;
  max-width: 768px;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 36px;
  padding: 16px 20px;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.08), 
    0 2px 4px rgba(0, 0, 0, 0.02);
  transition: all 0.2s;
  
  ${(props) => props.theme.isDark && `
    background: rgba(40, 40, 40, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
  `}

  &:focus-within {
    box-shadow: 
      0 12px 48px rgba(0, 0, 0, 0.12), 
      0 0 0 2px ${(props) => props.theme.brand.dark};
  }
`;

const InputRow = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  margin-top: 8px;
`;

const ModalScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  ${scrollbarMixin}
`;

// Documents Panel

const DocumentsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  background: ${(props) => props.theme.background};
`;

const DocumentsTitle = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const DocumentsPanel = styled(motion.div)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: 100%;
  background: ${(props) => props.theme.background};
  border-left: 1px solid ${(props) => props.theme.divider};
  box-shadow: -8px 0 32px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  z-index: 501;
`;

const ChevronIconWrapper = styled.div`
  display: flex;
  align-items: center;
  color: ${(props) => props.theme.textTertiary};
`;

const Avatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  margin-top: 4px;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const MessageContent = styled.div<{ $isUser: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 80%;
  min-width: 0; /* Allow shrinking for responsiveness */
  align-items: ${(props) => (props.$isUser ? "flex-end" : "flex-start")};
  
  @media (max-width: 768px) {
    max-width: 90%; /* Increase max-width on mobile */
  }
`;

const MarkdownWrapper = styled.div`
  font-size: 14px;
  line-height: 1.6;
  color: ${(props) => props.theme.text};
  overflow-wrap: break-word;
  min-width: 0;
  width: 100%; /* Ensure it respects parent width */
  max-width: 100%;

  h1, h2, h3, h4, h5, h6 {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.25;
  }

  h1 { font-size: 1.25em; }
  h2 { font-size: 1.15em; }
  h3 { font-size: 1.1em; }
  h4 { font-size: 1em; }
  
  p {
    margin-bottom: 12px;
    &:last-child {
      margin-bottom: 0;
    }
  }

  a {
    color: ${(props) => props.theme.brand.dark};
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  
  code {
    background: ${(props) => props.theme.slateLight};
    padding: 2px 4px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9em;
  }
  
  pre {
    background: ${(props) => props.theme.codeBackground || props.theme.slateLight};
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    width: 100%;
    max-width: 100%; /* Ensure it doesn't overflow */
    white-space: pre;
    
    code {
      background: transparent;
      padding: 0;
      border-radius: 0;
    }
  }
  
  ul, ol {
    margin: 12px 0;
    padding-left: 24px;
  }
  
  li {
    margin-bottom: 4px;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 12px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    cursor: zoom-in;
    transition: transform 0.2s ease-in-out;

    &:hover {
      transform: scale(1.01);
    }
  }

  /* 
   * Minimalist Table Design
   * Aesthetic: Simple, Light, Clean
   */
  .table-wrapper {
    display: block;
    width: 100%;
    overflow-x: auto;
    margin: 16px 0;
    border: 1px solid ${(props) => props.theme.divider};
    border-radius: 6px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    border: none;
  }

  th, td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid ${(props) => props.theme.divider};
    border-right: 1px solid ${(props) => props.theme.divider};

    &:last-child {
      border-right: none;
    }
  }

  /* Table Header */
  thead tr {
    background: transparent;
  }

  th {
    font-weight: 600;
    color: ${(props) => props.theme.text};
    border-bottom: 1px solid ${(props) => props.theme.divider};
    white-space: nowrap;
  }

  /* Table Body */
  tbody tr {
    &:last-child td {
      border-bottom: none;
    }
  }

  td {
    color: ${(props) => props.theme.text};
    line-height: 1.4;
    min-width: 80px;
    vertical-align: top;
  }

  /* Mermaid Diagrams */
  .mermaid-diagram {
    display: flex;
    justify-content: center;
    margin: 16px 0;
    padding: 16px;
    background: ${(props) => props.theme.background};
    border-radius: 8px;
    overflow-x: auto;
    max-width: 100%; /* Prevent overflow */
    
    &.error {
      background: ${(props) => props.theme.slateLight};
      color: ${(props) => props.theme.textTertiary};
    }

    svg {
      max-width: 100%;
      height: auto;
    }
  }

  .mermaid-error {
    font-family: monospace;
    font-size: 12px;
    color: ${(props) => props.theme.danger};
  }

  /* Error Message */
  .chat-error-message {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin: 12px 0;
    padding: 12px 16px;
    
    background: ${(props) => transparentize(0.9, props.theme.danger)};
    border: 1px solid ${(props) => transparentize(0.8, props.theme.danger)};
    border-radius: 8px;
    
    color: ${(props) => props.theme.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;

    &::before {
      content: "!";
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      background: ${(props) => props.theme.danger};
      color: ${(props) => props.theme.white};
      border-radius: 50%;
      font-weight: 800;
      font-size: 12px;
      margin-top: 2px;
    }
  }
`;

const bounce = keyframes`
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
`;

const TypingIndicator = styled.div`
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: ${(props) => props.theme.slateLight};
  border-radius: 20px;
  border-bottom-left-radius: 4px;
  width: fit-content;

  span {
    width: 8px;
    height: 8px;
    background: ${(props) => props.theme.textTertiary};
    border-radius: 50%;
    display: inline-block;
    animation: ${bounce} 1.4s infinite ease-in-out both;
    
    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
`;

const SourcesContainer = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SourcesLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${(props) => props.theme.textTertiary};
  letter-spacing: 0.05em;
`;

const SourcesGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const StyledInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: 16px;
  padding: 8px;
  color: ${(props) => props.theme.text};
  outline: none;
  
  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }
`;

const TimeSeparatorContainer = styled.div`
  display: flex;
  justify-content: center;
  margin: 16px 0;
  width: 100%;
`;

const TimeText = styled.span`
  font-size: 12px;
  color: rgb(161, 158, 153);
  padding: 0 8px;
`;

const SendButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: ${(props) => props.disabled ? props.theme.slateLight : props.theme.text};
  color: ${(props) => props.disabled ? props.theme.textTertiary : props.theme.background};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => props.disabled ? "not-allowed" : "pointer"};
  transition: all 0.2s;
  flex-shrink: 0;
  box-shadow: ${(props) => props.disabled ? "none" : "0 2px 8px rgba(0,0,0,0.15)"};

  &:hover:not(:disabled) {
    transform: scale(1.05);
    background: ${(props) => props.theme.text};
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  
  .loading-dot {
    width: 8px;
    height: 8px;
    background: currentColor;
    border-radius: 50%;
    animation: ${bounce} 1s infinite;
  }
`;

const ModalBackBtn = styled.button`
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.text};
  border-radius: 4px;
  
  &:hover {
    background: ${(props) => props.theme.slateLight};
  }
`;

const ChunksGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  ${scrollbarMixin}
`;

const ChunkCard = styled.div`
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover {
    border-color: ${(props) => props.theme.textTertiary};
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
`;

const ChunkHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', 'Droid Sans Mono', 'Source Code Pro', monospace;
  font-size: 11px;
  color: ${(props) => props.theme.textTertiary};
  letter-spacing: 0.02em;
  background: ${(props) => props.theme.slateLight};
  padding: 4px 8px;
  border-radius: 6px;
  width: fit-content;
`;

const ChunkIndex = styled.span`
  font-weight: 600;
  color: ${(props) => props.theme.textSecondary};
  margin-right: 8px;
`;

const ChunkId = styled.span`
  opacity: 0.7;
`;

const ChunkText = styled.div`
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  color: ${(props) => props.theme.text};
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
`;

const LoadingState = styled.div`
  padding: 40px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
`;

const DocSection = styled.div`
  margin-bottom: 24px;
`;

const SectionLabel = styled.div`
  padding: 8px 28px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${(props) => props.theme.textTertiary};
  letter-spacing: 0.05em;
`;

const DocList = styled.div`
  display: flex;
  flex-direction: column;
  padding-bottom: 24px;
  gap: 4px;
  padding: 0 12px;
`;

const DocItem = styled.div<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  width: 100%;
  box-sizing: border-box;
  cursor: ${(props) => props.$disabled ? "default" : "pointer"};
  transition: all 0.2s ease;
  opacity: ${(props) => props.$disabled ? 0.7 : 1};
  border-radius: 12px;
  border: 1px solid transparent;
  
  &:hover {
    background: ${(props) => !props.$disabled && props.theme.slateLight};
    border-color: ${(props) => !props.$disabled && props.theme.divider};
    transform: ${(props) => !props.$disabled && "translateY(-1px)"};
    box-shadow: ${(props) => !props.$disabled && "0 2px 8px rgba(0,0,0,0.04)"};
  }
`;

const DocIcon = styled.div<{ $isError?: boolean; $isWarning?: boolean }>`
  color: ${(props) => 
    props.$isError ? props.theme.danger : 
    props.$isWarning ? props.theme.warning : 
    props.theme.textSecondary
  };
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: ${(props) => 
    props.$isError ? props.theme.danger || "rgba(255,0,0,0.1)" : 
    props.$isWarning ? props.theme.warning || "rgba(255,165,0,0.1)" : 
    props.theme.background
  };
  border: 1px solid ${(props) => props.theme.divider};
  
  .spin {
    animation: spin 2s linear infinite;
  }
  
  @keyframes spin {
    100% { transform: rotate(360deg); }
  }
`;

const MoreIconWrapper = styled.div`
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const DocInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const DocTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DocMeta = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DocStatus = styled.div<{ $isError?: boolean; $isWarning?: boolean }>`
  font-size: 12px;
  color: ${(props) => 
    props.$isError ? props.theme.danger : 
    props.$isWarning ? props.theme.warning : 
    props.theme.textTertiary
  };
`;

const DocError = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.danger};
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const EmptyStateSmall = styled.div`
  padding: 40px 20px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
  font-size: 14px;
`;

const DeleteAction = styled.button`
  opacity: 0;
  background: transparent;
  border: none;
  color: ${(props) => props.theme.textTertiary};
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  ${CommandItem}:hover & {
    opacity: 1;
  }

  &:hover {
    background: ${(props) => props.theme.danger || "rgba(255, 0, 0, 0.1)"};
    color: ${(props) => props.theme.danger};
  }
`;

const EmptySearch = styled.div`
  padding: 32px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
  font-size: 14px;
`;





const DocumentsContent = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 0;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${(props) => props.theme.divider};
    border-radius: 3px;
  }
  &:hover::-webkit-scrollbar-thumb {
    background: ${(props) => props.theme.textTertiary};
  }
`;

const CollectionSelectorWrapper = styled.div`
  display: flex;
  align-self: flex-start;
  padding-bottom: 0;
  position: relative;
`;

const CollectionSelectorButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => props.theme.textTertiary};
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: -10px;

  &:hover, &[aria-expanded="true"] {
    background: ${(props) => props.theme.slateLight};
    color: ${(props) => props.theme.text};
  }
  
  svg {
    opacity: 0.8;
  }
`;

export default observer(RAGChat);
