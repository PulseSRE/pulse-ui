import { useState, useRef, useCallback, useEffect } from 'react';

interface WebTerminalProps {
  open: boolean;
  onClose: () => void;
}

interface TerminalEntry {
  id: number;
  command: string;
  output: string;
}

const WebTerminal: React.FC<WebTerminalProps> = ({ open, onClose }) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [nextId, setNextId] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [history]);

  const handleSubmit = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const cmd = input.trim();
    if (!cmd) return;

    const entry: TerminalEntry = {
      id: nextId,
      command: cmd,
      output: `bash: ${cmd.split(' ')[0]}: command not available in demo mode`,
    };

    setHistory((prev) => [...prev, entry]);
    setNextId((n) => n + 1);
    setInput('');
  }, [input, nextId]);

  if (!open) return null;

  return (
    <div className="compass-log-viewer compass-web-terminal">
      <div className="compass-log-viewer__toolbar">
        <span className="compass-log-viewer__toolbar-title">Terminal</span>
        <button
          type="button"
          className="compass-deploy-close"
          aria-label="Close terminal"
          onClick={onClose}
        >
          &#x2715;
        </button>
      </div>
      <div
        ref={contentRef}
        className="compass-log-viewer__content"
        onClick={() => inputRef.current?.focus()}
        role="log"
      >
        {history.map((entry) => (
          <div key={entry.id}>
            <div className="compass-log-line">
              <span className="compass-log-line-content">$ {entry.command}</span>
            </div>
            <div className="compass-log-line">
              <span className="compass-log-line-content">{entry.output}</span>
            </div>
          </div>
        ))}
        <div className="compass-log-line">
          <span className="compass-log-line-content">
            ${' '}
            <input
              ref={inputRef}
              type="text"
              className="compass-web-terminal__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleSubmit}
              aria-label="Terminal input"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </div>
      </div>
    </div>
  );
};

export default WebTerminal;
