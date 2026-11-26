import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function SettingsSection({ id, title, icon: Icon, children }: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const headingId = `${id}-title`;
  const contentId = `${id}-content`;

  return <section className="settings-section" aria-labelledby={headingId}>
    <header className="settings-section-heading">
      <h3 id={headingId}>
        <button className="settings-section-toggle" type="button" aria-expanded={expanded}
          aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
          <Icon size={17} aria-hidden="true" />
          <span>{title}</span>
          <ChevronDown size={16} className="settings-section-chevron" aria-hidden="true" />
        </button>
      </h3>
    </header>
    <div id={contentId} hidden={!expanded}>{children}</div>
  </section>;
}
