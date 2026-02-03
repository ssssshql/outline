import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { css } from "styled-components";
import { transparentize } from "polished";
import { 
  BeakerIcon, 
  CommentIcon, 
  GraphIcon, 
  BuildingBlocksIcon 
} from "outline-icons";
import Button from "~/components/Button";
import InputBase, { Outline } from "~/components/Input";
import CustomModal from "~/components/CustomModal";
import { client } from "~/utils/ApiClient";
import Flex from "~/components/Flex";

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
  RAG_TEMPERATURE?: number;
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

  const handleChange = (key: keyof RAGSettings, value: string | number) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <CustomModal
      title={t("RAG Configuration")}
      onRequestClose={onRequestClose}
      isOpen
      width="680px"
    >
      <Form onSubmit={handleSubmit} noValidate>
        <ScrollableContent>

          <Grid>
            {/* Chat Configuration */}
            <Section>
              <SectionHeader>
                <SectionIcon>
                  <CommentIcon size={24} />
                </SectionIcon>
                <SectionText>
                  <SectionTitle>{t("Chat Configuration")}</SectionTitle>
                  <SectionDescription>{t("The brain behind the chat responses.")}</SectionDescription>
                </SectionText>
              </SectionHeader>

              <FormGroup>
                <Label>
                  {t("Chat Model")}
                  <Required>*</Required>
                </Label>
                <StyledInput
                  value={settings.RAG_CHAT_MODEL || ""}
                  onChange={(e) => handleChange("RAG_CHAT_MODEL", e.target.value)}
                  placeholder="gpt-4o"
                />
              </FormGroup>

              <Row>
                <FormGroup style={{ flex: 1 }}>
                  <Label>
                    {t("Chat API Key")}
                    <Required>*</Required>
                  </Label>
                  <StyledInput
                    type="password"
                    value={settings.RAG_CHAT_API_KEY || ""}
                    onChange={(e) => handleChange("RAG_CHAT_API_KEY", e.target.value)}
                    placeholder="sk-..."
                  />
                </FormGroup>
                <FormGroup style={{ flex: 1 }}>
                  <Label>
                    {t("Chat Base URL")}
                    <Required>*</Required>
                  </Label>
                  <StyledInput
                    value={settings.RAG_CHAT_BASE_URL || ""}
                    onChange={(e) => handleChange("RAG_CHAT_BASE_URL", e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </FormGroup>
              </Row>

              <FormGroup>
                <Flex align="center" justify="space-between" style={{ marginBottom: 12 }}>
                  <Label style={{ marginBottom: 0 }}>
                    {t("Creativity (Temperature)")}
                  </Label>
                  <ValueBadge>{settings.RAG_TEMPERATURE ?? 0.4}</ValueBadge>
                </Flex>
                
                <RangeContainer>
                  <RangeInput 
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={settings.RAG_TEMPERATURE ?? 0.4}
                    onChange={(e) => handleChange("RAG_TEMPERATURE", parseFloat(e.target.value))}
                  />
                  <RangeTicks>
                    <span>{t("Precise")}</span>
                    <span>{t("Balanced")}</span>
                    <span>{t("Creative")}</span>
                  </RangeTicks>
                </RangeContainer>
              </FormGroup>
            </Section>

            <Divider />

            {/* Embedding Configuration */}
            <Section>
              <SectionHeader>
                <SectionIcon>
                  <GraphIcon size={24} />
                </SectionIcon>
                <SectionText>
                  <SectionTitle>{t("Embedding Configuration")}</SectionTitle>
                  <SectionDescription>{t("How your documents are understood and vectorized.")}</SectionDescription>
                </SectionText>
              </SectionHeader>

              <FormGroup>
                <Label>
                  {t("Embedding Model")}
                  <Required>*</Required>
                </Label>
                <StyledInput
                  value={settings.RAG_EMBEDDING_MODEL || ""}
                  onChange={(e) => handleChange("RAG_EMBEDDING_MODEL", e.target.value)}
                  placeholder="text-embedding-3-small"
                />
              </FormGroup>

              <Row style={{ marginBottom: 12 }}>
                <FormGroup style={{ flex: 1, marginBottom: 0 }}>
                  <Label>
                    {t("OpenAI API Key (Embedding)")}
                    <Required>*</Required>
                  </Label>
                  <StyledInput
                    type="password"
                    value={settings.RAG_OPENAI_API_KEY || ""}
                    onChange={(e) => handleChange("RAG_OPENAI_API_KEY", e.target.value)}
                    placeholder="sk-..."
                  />
                </FormGroup>
                <FormGroup style={{ flex: 1, marginBottom: 0 }}>
                  <Label>
                    {t("OpenAI Base URL (Embedding)")}
                    <Required>*</Required>
                  </Label>
                  <StyledInput
                    value={settings.RAG_OPENAI_BASE_URL || ""}
                    onChange={(e) => handleChange("RAG_OPENAI_BASE_URL", e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </FormGroup>
              </Row>
              
              <FormGroup>
                <Label>{t("Embedding Dimensions")}</Label>
                <StyledInput
                  type="text"
                  value={settings.RAG_EMBEDDING_DIMENSIONS || ""}
                  onChange={(e) => handleChange("RAG_EMBEDDING_DIMENSIONS", e.target.value)}
                  placeholder="1024"
                />
              </FormGroup>
            </Section>
            
            <Divider />

            {/* Advanced Indexing */}
            <Section>
              <SectionHeader>
                <SectionIcon>
                  <BuildingBlocksIcon size={24} />
                </SectionIcon>
                <SectionText>
                  <SectionTitle>{t("Indexing Configuration")}</SectionTitle>
                  <SectionDescription>{t("Granular control over chunking and retrieval.")}</SectionDescription>
                </SectionText>
              </SectionHeader>
              
              <Row>
                 <FormGroup style={{ flex: 1 }}>
                  <Label>{t("Chunk Size")}</Label>
                  <StyledInput
                    type="text"
                    value={settings.RAG_CHUNK_SIZE || ""}
                    onChange={(e) => handleChange("RAG_CHUNK_SIZE", e.target.value)}
                    placeholder="500"
                  />
                </FormGroup>
                <FormGroup style={{ flex: 1 }}>
                  <Label>{t("Chunk Overlap")}</Label>
                  <StyledInput
                    type="text"
                    value={settings.RAG_CHUNK_OVERLAP || ""}
                    onChange={(e) => handleChange("RAG_CHUNK_OVERLAP", e.target.value)}
                    placeholder="50"
                  />
                </FormGroup>
              </Row>

              <Row>
                <FormGroup style={{ flex: 1 }}>
                  <Label>{t("Retrieval Count (K)")}</Label>
                  <StyledInput
                    type="text"
                    value={settings.RAG_RETRIEVAL_K || ""}
                    onChange={(e) => handleChange("RAG_RETRIEVAL_K", e.target.value)}
                    placeholder="10"
                  />
                </FormGroup>
                <FormGroup style={{ flex: 1 }}>
                  <Label>{t("Score Threshold")}</Label>
                  <StyledInput
                    type="text"
                    value={settings.RAG_SCORE_THRESHOLD || ""}
                    onChange={(e) => handleChange("RAG_SCORE_THRESHOLD", e.target.value)}
                    placeholder="0.4"
                  />
                </FormGroup>
              </Row>
            </Section>
          </Grid>
        </ScrollableContent>

        <Footer>
          <Button type="submit" disabled={loading || saving} style={{ minWidth: 120 }}>
            {saving ? t("Saving...") : t("Save changes")}
          </Button>
        </Footer>
      </Form>
    </CustomModal>
  );
}

// Styled Components

const Form = styled.form`
  display: flex;
  flex-direction: column;
  height: 75vh;
  background: ${(props) => props.theme.background};
`;

const ScrollableContent = styled.div`
  overflow-y: auto;
  flex: 1;
  padding: 0;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${(props) => transparentize(0.8, props.theme.text)};
    border-radius: 3px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: ${(props) => transparentize(0.6, props.theme.text)};
  }
`;

const HeaderBanner = styled.div`
  padding: 32px 32px 24px;
  background: linear-gradient(
    to bottom right,
    ${(props) => transparentize(0.95, props.theme.brand.dark)},
    ${(props) => props.theme.background}
  );
  border-bottom: 1px solid ${(props) => props.theme.divider};
  display: flex;
  gap: 16px;
  align-items: flex-start;
`;

const HeaderIcon = styled.div`
  font-size: 24px;
  background: ${(props) => props.theme.background};
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  border: 1px solid ${(props) => props.theme.divider};
`;

const HeaderContent = styled.div`
  flex: 1;
`;

const HeaderTitle = styled.h2`
  font-size: 20px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0 0 4px 0;
`;

const HeaderDescription = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textSecondary};
  margin: 0;
  line-height: 1.5;
`;

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 32px;
  max-width: 640px;
  margin: 0 auto;
`;

const Section = styled.section`
  background: ${(props) => props.theme.background};
  border-radius: 12px;
  /* border: 1px solid ${(props) => props.theme.divider}; */
`;

const SectionHeader = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  align-items: flex-start;
`;

const SectionIcon = styled.div`
  color: ${(props) => props.theme.textSecondary};
  display: flex;
  align-items: center;
  height: 24px; /* Align with title line height roughly or just center */
`;

const SectionText = styled.div`
  flex: 1;
`;

const SectionTitle = styled.h3`
  font-size: 15px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0 0 2px 0;
`;

const SectionDescription = styled.p`
  font-size: 13px;
  color: ${(props) => props.theme.textTertiary};
  margin: 0;
`;

const Row = styled.div`
  display: flex;
  gap: 16px;
  
  @media (max-width: 600px) {
    flex-direction: column;
    gap: 0;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 20px;
  position: relative;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => props.theme.textSecondary};
  transition: color 0.2s;

  ${FormGroup}:focus-within & {
    color: ${(props) => props.theme.text};
  }
`;

const Required = styled.span`
  color: ${(props) => props.theme.danger};
  margin-left: 4px;
  font-size: 12px;
`;

const Divider = styled.div`
  height: 1px;
  background: ${(props) => props.theme.divider};
  margin: 12px 0;
  width: 100%;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 16px 32px;
  border-top: 1px solid ${(props) => props.theme.divider};
  background: ${(props) => props.theme.background};
`;

const StyledInput = styled(InputBase)`
  width: 100%;
  font-family: 'Inter', sans-serif; // Ensure font consistency
  
  ${Outline} {
    background: ${(props) => props.theme.isDark ? transparentize(0.9, props.theme.text) : transparentize(0.5, props.theme.slateLight)};
    border-color: transparent;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  &:hover ${Outline} {
    background: ${(props) => props.theme.isDark ? transparentize(0.8, props.theme.text) : props.theme.slateLight};
  }

  &:focus-within ${Outline} {
    background: ${(props) => props.theme.background};
    border-color: ${(props) => props.theme.brand.dark};
    box-shadow: 0 0 0 4px ${(props) => transparentize(0.9, props.theme.brand.dark)};
  }

  input {
    padding: 10px 12px;
    font-size: 14px;
  }
`;

const ValueBadge = styled.span`
  background: ${(props) => props.theme.slateLight};
  color: ${(props) => props.theme.text};
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  min-width: 32px;
  text-align: center;
`;

const RangeContainer = styled.div`
  padding: 8px 0;
`;

const RangeInput = styled.input`
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, 
    ${(props) => props.theme.brand.dark} 0%, 
    ${(props) => props.theme.brand.dark} ${(props) => (props.value as number) * 100}%, 
    ${(props) => props.theme.slateLight} ${(props) => (props.value as number) * 100}%, 
    ${(props) => props.theme.slateLight} 100%
  );
  appearance: none;
  outline: none;
  cursor: pointer;
  margin-bottom: 8px;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    border: 2px solid ${(props) => props.theme.brand.dark};
    cursor: grab;
    transition: transform 0.1s, box-shadow 0.2s;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);

    &:hover {
      transform: scale(1.1);
    }
    
    &:active {
      cursor: grabbing;
      box-shadow: 0 0 0 4px ${(props) => transparentize(0.8, props.theme.brand.dark)};
    }
  }
`;

const RangeTicks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: ${(props) => props.theme.textTertiary};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

export default RAGSettingsModal;
