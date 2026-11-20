import type { Locale } from '../../app/i18n';
import { demoAddress, demoMessages, type DemoMessage } from './demo-mail';
import { turkishDemoMessages } from './demo-mail.tr';

const workAddress = 'work@example.com';
const workMessages: DemoMessage[] = [
  {
    id: 'work-1', sender: 'Ada Studio', address: 'ada@example.com', to: `${workAddress}, deniz@example.com`,
    subject: 'Friday launch checklist',
    body: ['The launch checklist is ready. Can you confirm the final screenshots before Friday?', 'Deniz will review the release notes.'],
    date: '11:15', sentAt: Date.UTC(2026, 10, 20, 11, 15),
    initials: 'A', tone: 'violet', folder: 'inbox', label: 'projects', unread: true,
  },
  {
    id: 'work-2', sender: 'Deniz Kaya', address: 'deniz@example.com',
    subject: 'Updated project timeline',
    body: ['I moved the review to Monday so we have time for feedback. The delivery date stays the same.'],
    date: '09:40', sentAt: Date.UTC(2026, 10, 20, 9, 40),
    initials: 'D', tone: 'teal', folder: 'inbox', label: 'work', starred: true,
  },
  {
    id: 'work-3', sender: 'Ece Aydın', address: 'ece@example.com',
    subject: 'Next week’s demo',
    body: ['The meeting room is booked for Tuesday at 14:00. Please bring anything you’d like to show.'],
    date: '08:45', sentAt: Date.UTC(2026, 10, 20, 8, 45),
    initials: 'E', tone: 'peach', folder: 'inbox', label: 'work', unread: true,
  },
];

const turkishWorkMessages: DemoMessage[] = [
  {
    ...workMessages[0], subject: 'Cuma yayını için kontrol listesi',
    body: ['Yayın için kontrol listesi hazır. Son ekran görüntülerini cumadan önce onaylayabilir misin?', 'Deniz sürüm notlarını gözden geçirecek.'],
  },
  {
    ...workMessages[1], subject: 'Güncellenen proje takvimi',
    body: ['Geri bildirim için zaman kalsın diye değerlendirmeyi pazartesiye aldım. Teslim tarihi aynı.'],
  },
  {
    ...workMessages[2], subject: 'Gelecek haftanın demosu',
    body: ['Toplantı odası salı günü 14.00 için ayrıldı. Göstermek istediğin çalışmaları yanında getir lütfen.'],
  },
];

interface DemoAccount {
  address: string;
  nameKey: 'demoAccount' | 'workDemoAccount';
  initials: string;
  messages: Record<Locale, DemoMessage[]>;
}

export const demoAccounts = {
  personal: { address: demoAddress, nameKey: 'demoAccount', initials: 'D', messages: { en: demoMessages, tr: turkishDemoMessages } },
  work: { address: workAddress, nameKey: 'workDemoAccount', initials: 'W', messages: { en: workMessages, tr: turkishWorkMessages } },
} satisfies Record<string, DemoAccount>;

export type DemoAccountId = keyof typeof demoAccounts;
