export type Folder = 'inbox' | 'starred' | 'archive';

export interface DemoMessage {
  id: string;
  sender: string;
  address: string;
  subject: string;
  body: string[];
  date: string;
  initials: string;
  tone: 'violet' | 'teal' | 'peach' | 'blue';
  archived?: boolean;
  unread?: boolean;
  starred?: boolean;
}

export const demoMessages: DemoMessage[] = [
  {
    id: 'welcome',
    sender: 'Nora Ellis',
    address: 'nora@example.com',
    subject: 'Welcome to Minimal Mail',
    body: [
      'A little space for the mail that matters.',
      'This is your sample inbox. Open a message, search for a conversation, or switch between folders to get a feel for the workspace.',
      'See you in the inbox,\nNora',
    ],
    date: '9:42 AM',
    initials: 'NE',
    tone: 'violet',
    unread: true,
    starred: true,
  },
  {
    id: 'notes',
    sender: 'Sam Rivera',
    address: 'sam@example.com',
    subject: 'Notes from our design review',
    body: ['I pulled together the decisions from this morning. We’ll keep the focus on a calmer inbox and a more readable message view.', 'Let me know if I missed anything.'],
    date: 'Yesterday',
    initials: 'SR',
    tone: 'teal',
    unread: true,
  },
  {
    id: 'trip',
    sender: 'Ayla Chen',
    address: 'ayla@example.com',
    subject: 'Weekend plans',
    body: ['The weather looks good for a walk by the water on Saturday. Want to meet at the ferry around ten?', 'I’ll bring coffee.'],
    date: 'Tue',
    initials: 'AC',
    tone: 'peach',
    starred: true,
  },
  {
    id: 'books',
    sender: 'Jamie Reed',
    address: 'jamie@example.com',
    subject: 'A few reading recommendations',
    body: ['Here are the titles we talked about last week. The library has copies of all three.', 'Let me know what you think when you get a chance to read them.'],
    date: 'Mon',
    initials: 'JR',
    tone: 'blue',
  },
  {
    id: 'travel',
    sender: 'Nora Ellis',
    address: 'nora@example.com',
    subject: 'Travel itinerary',
    body: ['Here’s a quick confirmation that the train tickets are sorted. I’ll meet you on the platform.'],
    date: 'Nov 12',
    initials: 'NE',
    tone: 'violet',
    archived: true,
  },
];
