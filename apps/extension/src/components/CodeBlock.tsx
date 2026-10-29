import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
export function CodeBlock({
  text,
  label = 'JSON',
}: {
  text: string;
  label?: string;
}) {
  const [notice, setNotice] = useState('');
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{label}</span>
        <button
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard
              .writeText(text)
              .then(() => setNotice('Copied'))
              .catch(() =>
                setNotice('Copy unavailable. Select the text to copy.'),
              );
          }}
        >
          {notice === 'Copied' ? <Check size={13} /> : <Copy size={13} />}{' '}
          {notice || 'Copy'}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
