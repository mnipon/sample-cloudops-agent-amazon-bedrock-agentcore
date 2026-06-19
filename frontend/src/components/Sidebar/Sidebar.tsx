import { useEffect, useCallback, useState, useRef } from 'react';
import type { SidebarProps, ConversationMetadata } from '@/types';
import styles from './Sidebar.module.css';

export function Sidebar({
  isOpen,
  onClose,
  conversations = [],
  activeConversationId = null,
  isLoadingList = false,
  listError = null,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  onRetryLoad,
}: SidebarProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Sort conversations by updatedAt descending
  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <>
      {isOpen && (
        <div
          className={styles.backdrop}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        aria-label="Sidebar navigation"
      >
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close sidebar"
          type="button"
        >
          ✕
        </button>
        <h2 className={styles.heading}>Conversations</h2>

        <button
          className={styles.newConversationButton}
          onClick={onNewConversation}
          type="button"
          aria-label="New Conversation"
        >
          + New Conversation
        </button>

        <div className={styles.conversationList} role="list" aria-label="Conversation list">
          {isLoadingList && <LoadingSkeleton />}

          {listError && (
            <div className={styles.errorState} role="alert">
              <p className={styles.errorText}>{listError}</p>
              <button
                className={styles.retryButton}
                onClick={onRetryLoad}
                type="button"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoadingList && !listError && sortedConversations.length === 0 && (
            <p className={styles.emptyState}>No conversations yet</p>
          )}

          {!isLoadingList &&
            !listError &&
            sortedConversations.map((conversation) => (
              <ConversationItem
                key={conversation.conversationId}
                conversation={conversation}
                isActive={conversation.conversationId === activeConversationId}
                onSelect={onSelectConversation}
                onRename={onRenameConversation}
                onDelete={onDeleteConversation}
              />
            ))}
        </div>
      </aside>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className={styles.skeletonContainer} aria-label="Loading conversations">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={styles.skeletonItem} />
      ))}
    </div>
  );
}

interface ConversationItemProps {
  conversation: ConversationMetadata;
  isActive: boolean;
  onSelect?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.conversationName);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleSelect = () => {
    if (!isRenaming && !isDeleting) {
      onSelect?.(conversation.conversationId);
    }
  };

  const handleRenameStart = () => {
    setRenameValue(conversation.conversationName);
    setIsRenaming(true);
    setMenuOpen(false);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.conversationName) {
      onRename?.(conversation.conversationId, trimmed);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
      setRenameValue(conversation.conversationName);
    }
  };

  const handleDeleteStart = () => {
    setIsDeleting(true);
    setMenuOpen(false);
  };

  const handleDeleteConfirm = () => {
    onDelete?.(conversation.conversationId);
    setIsDeleting(false);
  };

  const handleDeleteCancel = () => {
    setIsDeleting(false);
  };

  const itemClasses = [
    styles.conversationItem,
    isActive ? styles.conversationItemActive : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (isDeleting) {
    return (
      <div className={styles.deleteConfirmation} role="listitem">
        <p className={styles.deleteText}>Delete this conversation?</p>
        <div className={styles.deleteActions}>
          <button
            className={styles.deleteConfirmButton}
            onClick={handleDeleteConfirm}
            type="button"
            aria-label="Confirm delete"
          >
            Delete
          </button>
          <button
            className={styles.deleteCancelButton}
            onClick={handleDeleteCancel}
            type="button"
            aria-label="Cancel delete"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={itemClasses} role="listitem">
      {isRenaming ? (
        <input
          ref={inputRef}
          className={styles.renameInput}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleRenameKeyDown}
          aria-label="Rename conversation"
          type="text"
        />
      ) : (
        <button
          className={styles.conversationButton}
          onClick={handleSelect}
          type="button"
          aria-label={`Open conversation: ${conversation.conversationName}`}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className={styles.conversationName}>
            {conversation.conversationName}
          </span>
        </button>
      )}

      <div className={styles.actionsWrapper} ref={menuRef}>
        <button
          className={styles.menuButton}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          type="button"
          aria-label={`Actions for ${conversation.conversationName}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          ⋯
        </button>

        {menuOpen && (
          <div className={styles.contextMenu} role="menu">
            <button
              className={styles.contextMenuItem}
              onClick={handleRenameStart}
              type="button"
              role="menuitem"
            >
              Rename
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={handleDeleteStart}
              type="button"
              role="menuitem"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
