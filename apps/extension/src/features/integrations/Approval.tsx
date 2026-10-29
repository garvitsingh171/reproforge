import { useState } from 'react';
import { X } from 'lucide-react';
import { CodeBlock } from '../../components/CodeBlock';
export function Approval({
  title,
  detail,
  data,
  action,
  busy,
  onApprove,
  onCancel,
}: {
  title: string;
  detail: string;
  data: string;
  action: string;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const [approved, setApproved] = useState(false);
  return (
    <div className="modal-backdrop">
      <dialog
        className="review-dialog"
        ref={(node) => {
          if (node && !node.open) node.showModal();
        }}
        onCancel={onCancel}
        aria-labelledby="approval-title"
      >
        <header>
          <h2 id="approval-title">{title}</h2>
          <button autoFocus aria-label="Cancel approval" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <p className="warning">{detail}</p>
        <CodeBlock label="Exact approved operation" text={data} />
        <label className="check">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          I reviewed this content and authorize this specific operation.
        </label>
        <footer>
          <button disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !approved}
            onClick={onApprove}
          >
            {busy ? 'Working…' : action}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
