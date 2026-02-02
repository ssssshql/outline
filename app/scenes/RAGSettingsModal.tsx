import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { transparentize } from "polished";
import Button from "~/components/Button";
import InputBase, { Outline } from "~/components/Input";
import Modal from "~/components/Modal";
import { client } from "~/utils/ApiClient";

interface RAGSettingsModalProps {
  onRequestClose: () => void;
}

interface RAGSettings {
  RAG_OPENAI_API_KEY?: string;
  RAG_OPENAI_BASE_URL?: string;
  RAG_EMBEDDING_MODEL?: string;
  RAG_EMBEDDING_DIMENSIONS?: number;
  RAG_CHAT_MODEL?: string;
  RAG_CHAT_API_KEY?: string;
  RAG_CHAT_BASE_URL?: string;
  RAG_CHUNK_SIZE?: number;
  RAG_CHUNK_OVERLAP?: number;
  RAG_RETRIEVAL_K?: number;
  RAG_SCORE_THRESHOLD?: number;
}

function RAGSettingsModal({ onRequestClose }: RAGSettingsModalProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = React.useState<RAGSettings>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const res = await client.post("/rag.settings.get");
        setSettings(res.data || {});
      } catch (error) {
        toast.error(t("Failed to load settings"));
      } finally {
        setLoading(false);
      }
    };
    void fetchSettings();
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Required fields validation
    const requiredFields: (keyof RAGSettings)[] = [
      "RAG_OPENAI_API_KEY",
      "RAG_OPENAI_BASE_URL",
      "RAG_EMBEDDING_MODEL",
      "RAG_CHAT_API_KEY",
      "RAG_CHAT_BASE_URL",
      "RAG_CHAT_MODEL",
    ];

    const missingFields = requiredFields.filter((key) => {
      const val = settings[key];
      return typeof val === "string" ? !val.trim() : !val;
    });

    if (missingFields.length > 0) {
      toast.error(t("Please fill in all required fields"));
      return;
    }

    // Numeric validation
    if (settings.RAG_EMBEDDING_DIMENSIONS) {
      const dim = Number(settings.RAG_EMBEDDING_DIMENSIONS);
      if (isNaN(dim) || dim <= 0 || !Number.isInteger(dim)) {
        toast.error(t("Embedding Dimensions must be a positive integer"));
        return;
      }
    }

    if (settings.RAG_RETRIEVAL_K) {
      const k = Number(settings.RAG_RETRIEVAL_K);
      if (isNaN(k) || k <= 0 || !Number.isInteger(k)) {
        toast.error(t("Retrieval Count (K) must be a positive integer"));
        return;
      }
    }

    let chunkSize = 0;
    if (settings.RAG_CHUNK_SIZE) {
      chunkSize = Number(settings.RAG_CHUNK_SIZE);
      if (isNaN(chunkSize) || chunkSize <= 0 || !Number.isInteger(chunkSize)) {
        toast.error(t("Chunk Size must be a positive integer"));
        return;
      }
    }

    if (settings.RAG_CHUNK_OVERLAP) {
      const overlap = Number(settings.RAG_CHUNK_OVERLAP);
      if (isNaN(overlap) || overlap < 0 || !Number.isInteger(overlap)) {
        toast.error(t("Chunk Overlap must be a non-negative integer"));
        return;
      }
      if (chunkSize > 0 && overlap >= chunkSize) {
        toast.error(t("Chunk Overlap must be smaller than Chunk Size"));
        return;
      }
    }

    if (settings.RAG_SCORE_THRESHOLD) {
      const threshold = Number(settings.RAG_SCORE_THRESHOLD);
      if (isNaN(threshold) || threshold < 0) {
        toast.error(t("Score Threshold must be a positive number"));
        return;
      }
    }

    setSaving(true);
    try {
      await client.post("/rag.settings.set", settings as any);
      toast.success(t("Settings saved successfully"));
      onRequestClose();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(t(error.message));
      } else {
        toast.error(t("Failed to save settings"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof RAGSettings, value: string) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <Modal
      title={t("RAG Configuration")}
      onRequestClose={onRequestClose}
      isOpen
      width="540px"
      overflow="hidden"
    >
      <Form onSubmit={handleSubmit} noValidate>
        <ScrollableContent>
          <Section>
            <SectionTitle>{t("Embedding Configuration")}</SectionTitle>
            <FormGroup>
              <Label>
                {t("OpenAI API Key (Embedding)")}
                <Required>*</Required>
              </Label>
              <Input
                type="password"
                value={settings.RAG_OPENAI_API_KEY || ""}
                onChange={(e) => handleChange("RAG_OPENAI_API_KEY", e.target.value)}
                placeholder="sk-..."
              />
            </FormGroup>
            <FormGroup>
              <Label>
                {t("OpenAI Base URL (Embedding)")}
                <Required>*</Required>
              </Label>
              <Input
                value={settings.RAG_OPENAI_BASE_URL || ""}
                onChange={(e) => handleChange("RAG_OPENAI_BASE_URL", e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </FormGroup>
            <FormGroup>
              <Label>
                {t("Embedding Model")}
                <Required>*</Required>
              </Label>
              <Input
                value={settings.RAG_EMBEDDING_MODEL || ""}
                onChange={(e) => handleChange("RAG_EMBEDDING_MODEL", e.target.value)}
                placeholder="text-embedding-3-small"
              />
            </FormGroup>
            <FormGroup>
              <Label>{t("Embedding Dimensions")}</Label>
              <Input
                type="text"
                value={settings.RAG_EMBEDDING_DIMENSIONS || ""}
                onChange={(e) => handleChange("RAG_EMBEDDING_DIMENSIONS", e.target.value)}
                placeholder="1024"
              />
            </FormGroup>
          </Section>

          <Section>
            <SectionTitle>{t("Chat Configuration")}</SectionTitle>
            <FormGroup>
              <Label>
                {t("Chat API Key")}
                <Required>*</Required>
              </Label>
              <Input
                type="password"
                value={settings.RAG_CHAT_API_KEY || ""}
                onChange={(e) => handleChange("RAG_CHAT_API_KEY", e.target.value)}
                placeholder={t("Chat API Key")}
              />
            </FormGroup>
            <FormGroup>
              <Label>
                {t("Chat Base URL")}
                <Required>*</Required>
              </Label>
              <Input
                value={settings.RAG_CHAT_BASE_URL || ""}
                onChange={(e) => handleChange("RAG_CHAT_BASE_URL", e.target.value)}
                placeholder={t("Chat Base URL")}
              />
            </FormGroup>
            <FormGroup>
              <Label>
                {t("Chat Model")}
                <Required>*</Required>
              </Label>
              <Input
                value={settings.RAG_CHAT_MODEL || ""}
                onChange={(e) => handleChange("RAG_CHAT_MODEL", e.target.value)}
                placeholder="gpt-4o"
              />
            </FormGroup>
            <FormGroup>
              <Label>{t("Retrieval Count (K)")}</Label>
              <Input
                type="text"
                value={settings.RAG_RETRIEVAL_K || ""}
                onChange={(e) => handleChange("RAG_RETRIEVAL_K", e.target.value)}
                placeholder="10"
              />
            </FormGroup>
            <FormGroup>
              <Label>{t("Score Threshold")}</Label>
              <Input
                type="text"
                value={settings.RAG_SCORE_THRESHOLD || ""}
                onChange={(e) => handleChange("RAG_SCORE_THRESHOLD", e.target.value)}
                placeholder="0.4"
              />
            </FormGroup>
          </Section>

          <Section>
            <SectionTitle>{t("Indexing Configuration")}</SectionTitle>
            <FormGroup>
              <Label>{t("Chunk Size")}</Label>
              <Input
                type="text"
                value={settings.RAG_CHUNK_SIZE || ""}
                onChange={(e) => handleChange("RAG_CHUNK_SIZE", e.target.value)}
                placeholder="500"
              />
            </FormGroup>
            <FormGroup>
              <Label>{t("Chunk Overlap")}</Label>
              <Input
                type="text"
                value={settings.RAG_CHUNK_OVERLAP || ""}
                onChange={(e) => handleChange("RAG_CHUNK_OVERLAP", e.target.value)}
                placeholder="50"
              />
            </FormGroup>
          </Section>
        </ScrollableContent>

        <Footer>
          <Button type="submit" disabled={loading || saving}>
            {saving ? t("Saving...") : t("Save")}
          </Button>
        </Footer>
      </Form>
    </Modal>
  );
}

const Form = styled.form`
  display: flex;
  flex-direction: column;
  height: 50vh;
`;

const ScrollableContent = styled.div`
  overflow-y: auto;
  padding: 0 4px;
  flex: 1;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: ${(props) => transparentize(0.5, props.theme.scrollbarThumb)};
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: ${(props) => props.theme.scrollbarThumb};
  }
`;

const Section = styled.section`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
  color: ${(props) => props.theme.text};
  border-bottom: 1px solid ${(props) => props.theme.divider};
  padding-bottom: 8px;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
`;

const Required = styled.span`
  color: ${(props) => props.theme.danger};
  margin-left: 4px;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 12px 24px;
  border-top: 1px solid ${(props) => props.theme.divider};
  margin-top: 16px;
  flex-shrink: 0;
  margin-left: -24px;
  margin-right: -24px;
  margin-bottom: -24px;
`;

const Input = styled(InputBase)`
  ${Outline} {
    background: rgb(241, 243, 246) !important;
  }

  &:focus-within ${Outline} {
    background: rgb(249, 250, 251) !important;
  }
`;

export default RAGSettingsModal;
