import { demoMessages, type DemoMessage } from './demo-mail';

type DemoTranslation = Pick<DemoMessage, 'subject' | 'body'> & Partial<Pick<
  DemoMessage, 'sender' | 'preview' | 'date' | 'received' | 'initials' | 'image' | 'attachments'
>>;

const translations: Record<DemoMessage['id'], DemoTranslation> = {
  'field-notes': {
    subject: 'Dolomitler saha notları',
    preview: 'Rota, saha notları ve dağ sırtından bir önizleme.',
    body: [
      'Merhaba,',
      'Rota belli oldu. Cuma günü gün doğmadan patikanın başlangıcında buluşup üst patikadan dağ sırtına çıkacağız. Saha notlarını ve bulutların üstündeki manzaradan bir fotoğrafı ekledim.',
      'Yukarıda görüşürüz!',
    ],
    received: 'Bugün 10:24',
    image: { url: '/demo/dolomites.jpg', alt: 'Gün doğumunda bulutların üzerindeki karlı Dolomit zirveleri' },
    attachments: [
      { name: 'Saha notları.txt', size: '259 B', type: 'text', url: '/demo/field-notes-tr.txt' },
      { name: 'Dağ önizlemesi.jpg', size: '157 KiB', type: 'image', url: '/demo/dolomites.jpg' },
    ],
  },
  trip: {
    subject: 'Hafta sonu planları',
    body: ['Cumartesi sahilde yürüyüş için hava güzel görünüyor. Saat on gibi vapur iskelesinde buluşalım mı?', 'Kahveyi ben getiririm.'],
  },
  notes: {
    subject: 'Tasarım değerlendirmesinden notlar',
    body: ['Bu sabahki kararları bir araya getirdim. Daha sade bir gelen kutusuna ve daha rahat okunabilen bir ileti görünümüne odaklanacağız.', 'Atladığım bir şey varsa haber ver.'],
  },
  welcome: {
    sender: 'Lusi Destek',
    subject: 'Lusi’ye hoş geldiniz',
    preview: 'Önemli postalarınız için küçük bir alan.',
    body: [
      'Örnek gelen kutunuza hoş geldiniz.',
      'Çalışma alanını keşfetmek için bir ileti açabilir, bir konuşma arayabilir veya klasörler arasında gezinebilirsiniz. Panel genişliklerini ve görünümü de ayarlayabilirsiniz.',
      'Gelen kutusunda görüşmek üzere,\nLusi',
    ],
    date: 'Dün',
  },
  files: {
    subject: 'İncelenecek tasarım dosyaları',
    body: ['Güncel tasarım dosyaları incelemeye hazır.', 'Gezinme ve tema değişikliklerine perşembe günü birlikte bakabiliriz.'],
    date: 'Dün',
  },
  books: {
    subject: 'Okuma önerileri',
    body: ['Geçen hafta konuştuğumuz kitapların listesi burada. Üçü de kütüphanede var.', 'Fırsat bulup okuduğunda ne düşündüğünü söyle.'],
    date: 'Pzt',
  },
  travel: {
    subject: 'Seyahat programı',
    body: ['Tren biletlerini hallettiğimizi teyit etmek istedim. Peronda buluşuruz.'],
    date: '12 Kas',
  },
  confirmed: {
    sender: 'Demo hesap',
    subject: 'Cuma kesinleşti',
    body: ['Cuma sabahı bana uygun. Saat 06.30’da orada olurum.'],
    date: 'Dün',
  },
  packing: {
    sender: 'Demo hesap',
    subject: 'Valiz kontrol listesi',
    body: ['Fotoğraf makinesi, yedek pil, not defteri.'],
    date: 'Dün',
  },
  old: {
    sender: 'Stüdyo Takvimi',
    subject: 'Eski toplantı daveti',
    body: ['Bu etkinlik takvimden kaldırıldı.'],
    date: '11 Kas',
  },
};

export const turkishDemoMessages = demoMessages.map((message) => ({ ...message, ...translations[message.id] }));
