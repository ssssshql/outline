import * as React from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import styled from "styled-components";
import { transparentize } from "polished";
import { CloseIcon } from "outline-icons";
import Flex from "~/components/Flex";

interface CustomModalProps {
  children: React.ReactNode;
  isOpen: boolean;
  onRequestClose: () => void;
  width?: string;
  title?: React.ReactNode;
}

const CustomModal: React.FC<CustomModalProps> = ({
  children,
  isOpen,
  onRequestClose,
  width = "600px",
  title,
}) => {
  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <Overlay
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onRequestClose}
        >
          <ModalContainer
            $width={width}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <Header>
                <Title>{title}</Title>
                <CloseButton onClick={onRequestClose}>
                  <CloseIcon size={20} />
                </CloseButton>
              </Header>
            )}
            {children}
          </ModalContainer>
        </Overlay>
      )}
    </AnimatePresence>,
    document.body
  );
};

const Overlay = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ModalContainer = styled(motion.div)<{ $width: string }>`
  width: 100%;
  max-width: ${(props) => props.$width};
  max-height: 90vh;
  background: ${(props) => props.theme.background};
  border-radius: 16px;
  box-shadow: 
    0 24px 48px -12px rgba(0, 0, 0, 0.18),
    0 0 0 1px ${(props) => props.theme.divider};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  margin: 0;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  color: ${(props) => props.theme.textTertiary};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    background: ${(props) => props.theme.slateLight};
    color: ${(props) => props.theme.text};
  }
`;

export default CustomModal;
