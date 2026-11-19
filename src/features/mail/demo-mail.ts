export type Mailbox = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive';
export type Label = 'work' | 'personal' | 'projects' | 'travel';
export type Folder = Mailbox | Label | 'starred';

export interface DemoAttachment {
  name: string;
  size: string;
  type: 'text' | 'image';
  url: string;
}

export interface DemoMessage {
  id: string;
  sender: string;
  address: string;
  subject: string;
  preview?: string;
  body: string[];
  date: string;
  received?: string;
  initials: string;
  tone: 'violet' | 'teal' | 'peach' | 'blue';
  folder: Mailbox;
  label?: Label;
  unread?: boolean;
  starred?: boolean;
  image?: { url: string; alt: string };
  attachments?: DemoAttachment[];
}

const ridge = '/demo/dolomites.jpg';

export const demoMessages: DemoMessage[] = [
  {
    id: 'field-notes',
    sender: 'Mona Studio',
    address: 'mona@example.com',
    subject: 'Dolomites field notes',
    preview: 'The route, field notes, and a little preview from the ridge.',
    body: [
      'Hi,',
      'The route is set. We’ll meet at the trailhead on Friday before sunrise and take the upper path to the ridge. I’ve attached the field notes and a preview of what the view looks like above the clouds.',
      'See you up there!',
    ],
    date: '10:24',
    received: 'Today at 10:24',
    initials: 'M',
    tone: 'violet',
    folder: 'inbox',
    label: 'travel',
    unread: true,
    image: { url: ridge, alt: 'Snow-covered Dolomite peaks above clouds at sunrise' },
    attachments: [
      { name: 'Field notes.txt', size: '252 B', type: 'text', url: '/demo/field-notes.txt' },
      { name: 'Ridge preview.jpg', size: '157 KiB', type: 'image', url: ridge },
    ],
  },
  {
    id: 'trip', sender: 'Ayla Chen', address: 'ayla@example.com', subject: 'Weekend plans',
    body: ['The weather looks good for a walk by the water on Saturday. Want to meet at the ferry around ten?', 'I’ll bring coffee.'],
    date: '09:17', initials: 'A', tone: 'blue', folder: 'inbox', label: 'personal', unread: true, starred: true,
  },
  {
    id: 'notes', sender: 'Sam Rivera', address: 'sam@example.com', subject: 'Notes from our design review',
    body: ['I pulled together the decisions from this morning. We’ll keep the focus on a calmer inbox and a more readable message view.', 'Let me know if I missed anything.'],
    date: '08:30', initials: 'S', tone: 'teal', folder: 'inbox', label: 'work', unread: true,
  },
  {
    id: 'welcome', sender: 'Luma Support', address: 'support@example.com', subject: 'Welcome to Luma',
    preview: 'A little space for the mail that matters.',
    body: [
      'Welcome to your sample inbox.',
      'Open a message, search for a conversation, or switch between folders to get a feel for the workspace. You can also adjust how much space each pane uses and choose the appearance that works for you.',
      'See you in the inbox,\nLuma',
    ],
    date: 'Yesterday', initials: 'L', tone: 'violet', folder: 'inbox', unread: true,
  },
  {
    id: 'files', sender: 'Onur Kaya', address: 'onur@example.com', subject: 'Design files for review',
    body: ['The latest design files are ready for review.', 'We can go through the navigation and theme changes on Thursday.'],
    date: 'Yesterday', initials: 'O', tone: 'peach', folder: 'inbox', label: 'projects', starred: true,
  },
  {
    id: 'books', sender: 'Jamie Reed', address: 'jamie@example.com', subject: 'Reading recommendations',
    body: ['Here are the titles we talked about last week. The library has copies of all three.', 'Let me know what you think when you get a chance to read them.'],
    date: 'Mon', initials: 'J', tone: 'blue', folder: 'inbox', label: 'personal',
  },
  {
    id: 'travel', sender: 'Nora Ellis', address: 'nora@example.com', subject: 'Travel itinerary',
    body: ['Here’s a quick confirmation that the train tickets are sorted. I’ll meet you on the platform.'],
    date: 'Nov 12', initials: 'N', tone: 'violet', folder: 'archive', label: 'travel',
  },
  {
    id: 'confirmed', sender: 'Demo account', address: 'demo@example.com', subject: 'Friday is confirmed',
    body: ['Friday morning works for me. I’ll be there at 06:30.'],
    date: 'Yesterday', initials: 'D', tone: 'blue', folder: 'sent', label: 'work',
  },
  {
    id: 'packing', sender: 'Demo account', address: 'demo@example.com', subject: 'Packing checklist',
    body: ['Camera, spare battery, notebook.'],
    date: 'Yesterday', initials: 'D', tone: 'blue', folder: 'drafts', label: 'travel',
  },
  {
    id: 'old', sender: 'Studio Calendar', address: 'calendar@example.com', subject: 'Old meeting invitation',
    body: ['This event has been removed from the calendar.'],
    date: 'Nov 11', initials: 'C', tone: 'teal', folder: 'trash',
  },
];

export function isInFolder(message: DemoMessage, folder: Folder) {
  if (folder === 'starred') return message.starred && message.folder !== 'trash';
  return message.folder === folder || (message.label === folder && message.folder !== 'trash');
}
