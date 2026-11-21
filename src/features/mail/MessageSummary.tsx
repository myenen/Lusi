import { Sparkles } from 'lucide-react';
import { useLabels } from '../../app/i18n';
import type { MessageSummary as Summary } from '../accounts/imap-api';

export function MessageSummary({ summary }: { summary: Summary }) {
  const labels = useLabels();

  return <details className="letter-summary" open>
    <summary>
      <Sparkles size={16} aria-hidden="true" />
      {labels.smartSummary}
      <span className="letter-summary-show" aria-hidden="true">{labels.showSummary}</span>
      <span className="letter-summary-hide" aria-hidden="true">{labels.hideSummary}</span>
    </summary>
    <ul className="letter-summary-points">
      {summary.points.map(({ kind, text }) => <li key={text}>
        <span className="letter-summary-kind">{labels.summaryPoint[kind]}</span>
        <span>{text}</span>
      </li>)}
    </ul>
  </details>;
}
