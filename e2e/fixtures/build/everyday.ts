import type { Address, Persona } from "../format.ts";
import {
  NEWSLETTER_FOOTER,
  PERSONAL_FOOTER,
  PERSONAL_FOOTER_EN_GB,
  RECEIPT_FOOTER,
} from "./footers.ts";
import type { Random } from "./random.ts";

// The non-job mail of each persona: newsletters (always with List-Unsubscribe, List-Id or
// Precedence: bulk, so stage one sorts them out), receipts and personal mail (never with those
// headers, so they reach the model and come back not_job).

export interface EverydayMail {
  from: Address;
  subject: string;
  body: string;
  footer: readonly string[];
  listId?: string;
  listUnsubscribe?: string;
  precedence?: string;
}

interface Newsletter {
  from: Address;
  /** Which bulk headers it carries. */
  headers: "unsubscribe" | "list" | "bulk";
  subjects: readonly string[];
  lines: readonly string[];
}

const nl = (
  address: string,
  name: string,
  headers: Newsletter["headers"],
  subjects: string[],
  lines: string[],
): Newsletter => ({ from: { address, name }, headers, subjects, lines });

const MARIA_NEWSLETTERS: readonly Newsletter[] = [
  nl(
    "digest@devweekly.example",
    "Dev Weekly",
    "list",
    [
      "Dev Weekly #212: faster builds",
      "Dev Weekly #213: the state of WebAssembly",
      "Dev Weekly #214: testing in production",
      "Dev Weekly #215: database migrations without fear",
    ],
    [
      "This week: three ways to cut your CI time in half.",
      "A deep dive into connection pooling.",
      "Why your logs should be structured.",
    ],
  ),
  nl(
    "hello@backendbrief.example",
    "The Backend Brief",
    "unsubscribe",
    [
      "Queues, explained",
      "The case for boring technology",
      "Idempotency keys in practice",
      "What we learned from a year of Kafka",
    ],
    [
      "Today's issue is about message queues and when you really need one.",
      "Plus: a reader question about retries and backoff.",
      "Five links we liked this week.",
    ],
  ),
  nl(
    "news@lojastejo.example",
    "Lojas Tejo",
    "unsubscribe",
    [
      "Até 40% de desconto este fim de semana",
      "Novidades de outono",
      "Só hoje: portes grátis",
      "A sua lista de desejos está em promoção",
    ],
    [
      "Descubra a nova coleção de outono.",
      "Aproveite os descontos em artigos de casa.",
      "Envios grátis em compras acima de 30 €.",
    ],
  ),
  nl(
    "newsletter@lisboaguide.example",
    "Lisboa City Guide",
    "unsubscribe",
    [
      "What's on in Lisbon this weekend",
      "5 new restaurants in Alfama",
      "Free concerts this month",
      "Autumn markets guide",
    ],
    [
      "Our picks for the weekend, from rooftop concerts to flea markets.",
      "New openings in the city centre.",
      "The best viewpoints for sunset.",
    ],
  ),
  nl(
    "recipes@kitchenstories.example",
    "Kitchen Stories",
    "bulk",
    [
      "Weeknight dinners in 20 minutes",
      "Soup season is here",
      "Your weekly meal plan",
      "Baking basics: sourdough",
    ],
    [
      "Three quick recipes for busy evenings.",
      "A shopping list for the whole week.",
      "Tips for keeping herbs fresh.",
    ],
  ),
  nl(
    "news@climbportugal.example",
    "Climb Portugal",
    "list",
    [
      "New routes in Sintra",
      "Bouldering competition results",
      "Gear sale: up to 30% off",
      "Safety refresher: belaying",
    ],
    [
      "Route setters have been busy this month.",
      "Results from the regional bouldering cup.",
      "Check your harness before every session.",
    ],
  ),
  nl(
    "digest@pgdigest.example",
    "Postgres Digest",
    "list",
    [
      "Postgres Digest: indexes that pay off",
      "Postgres Digest: vacuum tuning",
      "Postgres Digest: JSONB patterns",
      "Postgres Digest: what's new in the latest release",
    ],
    [
      "A practical look at partial indexes.",
      "How autovacuum decides what to clean.",
      "Reader tip: use EXPLAIN (ANALYZE, BUFFERS).",
    ],
  ),
  nl(
    "news@gonews.example",
    "Go Newsletter",
    "unsubscribe",
    [
      "Go News: generics one year on",
      "Go News: profiling made easy",
      "Go News: structured logging",
      "Go News: release candidates",
    ],
    [
      "New in the standard library this month.",
      "A tutorial on pprof.",
      "Community conferences coming up.",
    ],
  ),
  nl(
    "offers@skylusa.example",
    "SkyLusa Offers",
    "unsubscribe",
    [
      "Autumn fares from 29 €",
      "Weekend getaways to Madrid",
      "Last chance: winter sale",
      "Fly to the Azores this November",
    ],
    [
      "Book by Sunday for our lowest fares.",
      "Hand luggage included on every fare.",
      "Collect points on every flight.",
    ],
  ),
  nl(
    "news@streambox.example",
    "StreamBox",
    "unsubscribe",
    [
      "New this week on StreamBox",
      "Your top picks for October",
      "Coming soon: the final season",
      "Documentaries we love",
    ],
    [
      "Fresh arrivals in drama and comedy.",
      "Recommended for you, based on what you watched.",
      "Download episodes to watch offline.",
    ],
  ),
  nl(
    "hi@linguapal.example",
    "LinguaPal",
    "bulk",
    [
      "Keep your streak going!",
      "Your weekly progress report",
      "New Dutch lessons are here",
      "Practice speaking in 5 minutes a day",
    ],
    [
      "You practised four days this week. Nice work!",
      "Try the new conversation lessons.",
      "Review the words you found hardest.",
    ],
  ),
  nl(
    "newsletter@museudigital.example",
    "Museu Digital",
    "list",
    [
      "Exposições de outono",
      "Visitas guiadas gratuitas",
      "Novo podcast do museu",
      "Oficinas para adultos",
    ],
    [
      "Conheça as novas exposições temporárias.",
      "Inscrições abertas para visitas guiadas.",
      "Ouça o novo episódio do nosso podcast.",
    ],
  ),
  nl(
    "news@oceancharity.example",
    "Ocean Care",
    "unsubscribe",
    [
      "Our beach clean-up results",
      "How your donation helped this year",
      "Join us on World Ocean Day",
      "Plastic-free autumn tips",
    ],
    [
      "Volunteers collected 2 tonnes of litter last month.",
      "Thank you for being part of our community.",
      "Simple swaps to cut plastic at home.",
    ],
  ),
  nl(
    "updates@readly.example",
    "Readly Daily",
    "unsubscribe",
    [
      "Your daily digest",
      "Stories picked for you",
      "Top reads this week",
      "Trending in technology",
    ],
    [
      "Five stories we think you'll like.",
      "From our editors: long reads for the weekend.",
      "Most shared articles this week.",
    ],
  ),
  nl(
    "news@trailrunner.example",
    "Trail Runner Magazine",
    "bulk",
    [
      "Trail shoes reviewed",
      "Training plan: your first ultra",
      "Race calendar for November",
      "Recovery tips after a long run",
    ],
    [
      "We tested twelve pairs of trail shoes.",
      "How to build up your weekly distance safely.",
      "Races near you this month.",
    ],
  ),
  nl(
    "hello@plantshop.example",
    "The Plant Shop",
    "unsubscribe",
    [
      "Indoor plants for low light",
      "Autumn bulbs are here",
      "Care guide: monstera",
      "Free delivery this week",
    ],
    [
      "Our favourite plants for darker rooms.",
      "Plant now for spring colour.",
      "Repotting made easy.",
    ],
  ),
  nl(
    "news@eurobackendconf.example",
    "EuroBackendConf",
    "list",
    [
      "Speakers announced",
      "Early-bird tickets end Friday",
      "Workshop schedule is live",
      "See you in Porto!",
    ],
    [
      "We're excited to share our first speakers.",
      "Workshops on observability and data modelling.",
      "Travel tips for attendees.",
    ],
  ),
  nl(
    "newsletter@cinemaforum.example",
    "Cinema Forum",
    "bulk",
    [
      "Esta semana no cinema",
      "Ciclo de cinema europeu",
      "Antestreias exclusivas",
      "Bilhetes a preço reduzido às terças",
    ],
    [
      "Os filmes em cartaz esta semana.",
      "Um ciclo dedicado ao cinema europeu.",
      "Sessões especiais com convidados.",
    ],
  ),
];

const TOM_NEWSLETTERS: readonly Newsletter[] = [
  nl(
    "digest@mcrevening.example",
    "Manchester Evening Digest",
    "unsubscribe",
    [
      "Your Manchester morning briefing",
      "What's on this weekend",
      "Traffic and travel update",
      "Best Sunday roasts in the city",
    ],
    [
      "Today's top stories from across Greater Manchester.",
      "Events and gigs coming up.",
      "Weather: cloudy with sunny spells.",
    ],
  ),
  nl(
    "news@northernrail.example",
    "Northern Rail Updates",
    "list",
    [
      "Engineering works this weekend",
      "Your season ticket offers",
      "Timetable changes from December",
      "Travel smarter this winter",
    ],
    [
      "Plan ahead: some services are replaced by buses.",
      "Save with a railcard.",
      "New timetables start next month.",
    ],
  ),
  nl(
    "hello@fithubgym.example",
    "FitHub Gym",
    "unsubscribe",
    [
      "New classes this month",
      "Bring a friend for free",
      "Your workout summary",
      "Holiday opening hours",
    ],
    [
      "Try our new spin and HIIT classes.",
      "Members can bring a friend every Friday.",
      "You visited 9 times last month.",
    ],
  ),
  nl(
    "news@reddevilsfans.example",
    "Red Devils Fan News",
    "bulk",
    [
      "Match preview: the derby",
      "Ticket ballot now open",
      "Player ratings from Saturday",
      "Away day travel guide",
    ],
    [
      "Everything you need to know before the derby.",
      "Enter the ballot for home tickets.",
      "Our ratings for every player.",
    ],
  ),
  nl(
    "offers@valuemart.example",
    "ValueMart",
    "unsubscribe",
    [
      "This week's big savings",
      "Double points weekend",
      "Meal deals for the family",
      "Your personalised offers",
    ],
    [
      "Save on fresh fruit and veg.",
      "Collect double points on everything.",
      "Family meal deals from £10.",
    ],
  ),
  nl(
    "listings@picturehouse.example",
    "Picturehouse Manchester",
    "bulk",
    [
      "This week's films",
      "Members' screening: Thursday",
      "Kids' club this Saturday",
      "Silver screen mornings",
    ],
    [
      "New releases and classic films this week.",
      "Free members' preview on Thursday.",
      "Tickets from £5 for kids' club.",
    ],
  ),
  nl(
    "news@councilbins.example",
    "Council Recycling News",
    "list",
    [
      "Bin collection changes",
      "Garden waste subscription",
      "Recycling tips for the holidays",
      "Bulky waste collections",
    ],
    [
      "Your collection day is changing next week.",
      "Renew your garden waste subscription.",
      "What can and can't go in the blue bin.",
    ],
  ),
  nl(
    "hello@bookbarn.example",
    "Book Barn",
    "unsubscribe",
    [
      "Staff picks for autumn",
      "3 for 2 on paperbacks",
      "Author event: book signing",
      "Your reading list",
    ],
    [
      "Our staff recommend their favourite reads.",
      "Mix and match across thousands of titles.",
      "Meet the author this Saturday.",
    ],
  ),
  nl(
    "news@canalwalks.example",
    "Canal Walks Club",
    "list",
    [
      "Sunday walk: Bridgewater Canal",
      "Photos from last week's walk",
      "Winter walking kit",
      "New walk leaders wanted",
    ],
    [
      "Meet at 10:00 by the lock.",
      "Thanks to everyone who came along.",
      "Stay warm and dry this winter.",
    ],
  ),
  nl(
    "updates@streamflix.example",
    "StreamFlix",
    "unsubscribe",
    ["New on StreamFlix this week", "Because you watched", "Coming soon", "Your weekend watchlist"],
    [
      "New series and films added this week.",
      "More shows like the ones you love.",
      "Set reminders for upcoming releases.",
    ],
  ),
];

/** Sends `count` newsletters spread over the senders, each with its bulk headers. */
export function newsletters(rnd: Random, persona: Persona, count: number): EverydayMail[] {
  const pool = persona === "maria" ? MARIA_NEWSLETTERS : TOM_NEWSLETTERS;
  return Array.from({ length: count }, (_, i) => {
    const n = pool[i % pool.length] as Newsletter;
    const domain = n.from.address.slice(n.from.address.indexOf("@") + 1);
    const issue = rnd.int(10000, 99999);
    const subject = rnd.pick(n.subjects);
    const mail: EverydayMail = {
      from: n.from,
      subject,
      body: [
        ...rnd.sample(n.lines, 2),
        `Read the full issue online: https://${domain}/issues/${issue}`,
      ].join("\n\n"),
      footer: NEWSLETTER_FOOTER,
    };
    if (n.headers === "unsubscribe" || n.headers === "list") {
      mail.listUnsubscribe = `<https://${domain}/unsubscribe?u=${issue}>, <mailto:unsubscribe@${domain}>`;
    }
    if (n.headers === "list") mail.listId = `${n.from.name} <news.${domain}>`;
    if (n.headers === "bulk") mail.precedence = "bulk";
    return mail;
  });
}

interface Receipt {
  from: Address;
  make: (rnd: Random) => { subject: string; body: string };
}

const MARIA_RECEIPTS: readonly Receipt[] = [
  {
    from: { address: "orders@lojastejo.example", name: "Lojas Tejo" },
    make: (r) => {
      const n = r.int(100000, 999999);
      return {
        subject: `A sua encomenda #${n} foi enviada`,
        body: `Olá Maria,\n\nA sua encomenda #${n} foi enviada e deve chegar em 2 a 3 dias úteis.\n\nTotal: ${r.int(15, 120)},${r.int(10, 99)} €\n\nObrigado pela sua compra!`,
      };
    },
  },
  {
    from: { address: "receipts@cityride.example", name: "CityRide" },
    make: (r) => ({
      subject: "Your ride receipt",
      body: `Thanks for riding with CityRide, Maria.\n\nTrip total: €${r.int(5, 25)}.${r.int(10, 99)}\nDistance: ${r.int(2, 15)} km\n\nRate your driver in the app.`,
    }),
  },
  {
    from: { address: "billing@vodafino.example", name: "Vodafino" },
    make: (r) => ({
      subject: "A sua fatura mensal está disponível",
      body: `Olá Maria,\n\nA sua fatura deste mês, no valor de ${r.int(20, 45)},${r.int(10, 99)} €, já está disponível na área de cliente.\n\nO pagamento será debitado automaticamente.`,
    }),
  },
  {
    from: { address: "faturas@electra-energia.example", name: "Electra Energia" },
    make: (r) => ({
      subject: "Fatura de eletricidade",
      body: `Olá Maria,\n\nA sua fatura de eletricidade está disponível. Consumo: ${r.int(90, 260)} kWh. Valor: ${r.int(30, 90)},${r.int(10, 99)} €.\n\nObrigado por escolher energia 100% renovável.`,
    }),
  },
  {
    from: { address: "orders@booknest.example", name: "BookNest" },
    make: (r) => ({
      subject: `Order confirmed: ${r.int(1, 3)} item(s)`,
      body: `Hi Maria,\n\nThanks for your order! We'll email you again when it ships.\n\nOrder total: €${r.int(12, 60)}.${r.int(10, 99)}`,
    }),
  },
  {
    from: { address: "bookings@skylusa.example", name: "SkyLusa Airlines" },
    make: (r) => {
      const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[r.int(0, 23)]).join(
        "",
      );
      return {
        subject: `Booking confirmation ${code}`,
        body: `Dear Maria Santos,\n\nYour booking ${code} is confirmed. Lisbon (LIS) to ${r.pick(["Berlin (BER)", "Amsterdam (AMS)", "Porto (OPO)", "Madrid (MAD)"])}.\n\nOnline check-in opens 36 hours before departure.`,
      };
    },
  },
  {
    from: { address: "pedidos@mercadofresco.example", name: "Mercado Fresco" },
    make: (r) => ({
      subject: "O seu pedido de supermercado está a caminho",
      body: `Olá Maria,\n\nO seu pedido com ${r.int(8, 30)} artigos será entregue hoje entre as ${r.int(17, 19)}:00 e as ${r.int(20, 21)}:00.\n\nBom apetite!`,
    }),
  },
  {
    from: { address: "billing@streambox.example", name: "StreamBox" },
    make: () => ({
      subject: "Your StreamBox payment receipt",
      body: "Hi Maria,\n\nWe've received your monthly payment of €11.99. Your plan renews next month.\n\nHappy watching!",
    }),
  },
  {
    from: { address: "recibos@ginasio-alfama.example", name: "Ginásio Alfama" },
    make: () => ({
      subject: "Recibo da mensalidade",
      body: "Olá Maria,\n\nEnviamos em anexo o recibo da sua mensalidade de 35,00 €.\n\nAté breve no ginásio!",
    }),
  },
  {
    from: { address: "noreply@parkingpay.example", name: "ParkingPay" },
    make: (r) => ({
      subject: "Parking session ended",
      body: `Hi Maria,\n\nYour parking session has ended. Duration: ${r.int(1, 4)} h ${r.int(0, 59)} min. Amount charged: €${r.int(1, 8)}.${r.int(10, 99)}.`,
    }),
  },
];

const TOM_RECEIPTS: readonly Receipt[] = [
  {
    from: { address: "orders@valuemart.example", name: "ValueMart" },
    make: (r) => ({
      subject: "Your ValueMart delivery is confirmed",
      body: `Hi Tom,\n\nYour grocery delivery is booked for ${r.pick(["Tuesday", "Thursday", "Saturday"])} between 6pm and 7pm.\n\nOrder total: £${r.int(30, 90)}.${r.int(10, 99)}`,
    }),
  },
  {
    from: { address: "receipts@metrotickets.example", name: "Metrolink Tickets" },
    make: (r) => ({
      subject: "Your ticket receipt",
      body: `Thanks for buying your ticket, Tom.\n\nWeekly ticket: £${r.int(15, 25)}.${r.int(10, 99)}\n\nShow the QR code in the app when asked.`,
    }),
  },
  {
    from: { address: "billing@northwater.example", name: "North Water" },
    make: (r) => ({
      subject: "Your water bill is ready",
      body: `Hello Tom,\n\nYour latest bill of £${r.int(25, 60)}.${r.int(10, 99)} is ready to view in your online account. It will be paid by Direct Debit.`,
    }),
  },
  {
    from: { address: "orders@bookbarn.example", name: "Book Barn" },
    make: () => ({
      subject: "Thanks for your order",
      body: "Hi Tom,\n\nWe've received your order and will let you know when it's on its way.\n\nHappy reading!",
    }),
  },
];

/** `count` receipts, round-robin over the persona's shops and services. */
export function receipts(rnd: Random, persona: Persona, count: number): EverydayMail[] {
  const pool = persona === "maria" ? MARIA_RECEIPTS : TOM_RECEIPTS;
  return Array.from({ length: count }, (_, i) => {
    const r = pool[i % pool.length] as Receipt;
    return { from: r.from, ...r.make(rnd), footer: RECEIPT_FOOTER };
  });
}

interface Topic {
  subject: string;
  body: string;
  /** What the persona answers, when they do. */
  reply: string;
}

const t = (subject: string, body: string, reply: string): Topic => ({ subject, body, reply });

const MARIA_FRIENDS: readonly Address[] = [
  { address: "ines.costa@mail.example", name: "Inês Costa" },
  { address: "pedro.santos@mail.example", name: "Pedro Santos" },
  { address: "ana.santos@mail.example", name: "Ana Santos" },
  { address: "lukas.meyer@post.example", name: "Lukas Meyer" },
  { address: "sara.lima@mail.example", name: "Sara Lima" },
  { address: "rui.fonseca@mail.example", name: "Rui Fonseca" },
];

const MARIA_TOPICS: readonly Topic[] = [
  t(
    "Dinner on Friday?",
    "Hey Maria,\n\nAre you free for dinner on Friday? I found a new place in Graça that does amazing petiscos.",
    "Sounds great, count me in! 8pm?",
  ),
  t(
    "Photos from Sintra",
    "Hi!\n\nHere are the photos from Sunday. The one at the palace is my favourite.",
    "These are lovely, thank you!",
  ),
  t(
    "Happy birthday!",
    "Parabéns, Maria! Hope you have a wonderful day and a great year ahead.",
    "Obrigada! See you on Saturday.",
  ),
  t(
    "Rent for October",
    "Olá Maria,\n\nJust a reminder that the rent for October is due on the 5th. Thanks!",
    "Thanks Rui, I'll transfer it this week.",
  ),
  t(
    "Christmas flights",
    "Hi sis,\n\nMum asks if you've booked your flights for Christmas yet. Let me know your dates.",
    "Not yet, I'll book this weekend and send you the dates.",
  ),
  t(
    "Book club: next pick",
    "Hello book club!\n\nNext month we're reading a novel set in Porto. See you on the 20th.",
    "Great choice, I'll bring snacks.",
  ),
  t(
    "Climbing on Saturday?",
    "Hey,\n\nWant to go climbing on Saturday morning? The gym opens at 9.",
    "Yes! See you there at 9:30.",
  ),
  t(
    "Your parcel is at my place",
    "Hi Maria,\n\nThe courier left your parcel with me. Pop by whenever you like.",
    "Thank you so much, I'll come by tonight.",
  ),
  t(
    "Recipe you asked for",
    "Hi,\n\nHere's the bacalhau à Brás recipe. Don't skip the olives!",
    "Thanks, making it tomorrow.",
  ),
  t(
    "Weekend in Berlin",
    "Hi Maria,\n\nWe're in Berlin the first weekend of November. Any chance you'll be around?",
    "Sadly not that weekend, but let's plan another time.",
  ),
];

const TOM_FRIENDS: readonly Address[] = [
  { address: "chidi.okafor@mail.example", name: "Chidi Okafor" },
  { address: "grace.okafor@mail.example", name: "Grace Okafor" },
  { address: "sam.turner@post.example", name: "Sam Turner" },
  { address: "ellie.shaw@mail.example", name: "Ellie Shaw" },
];

const TOM_TOPICS: readonly Topic[] = [
  t(
    "Five-a-side Thursday?",
    "Alright Tom,\n\nWe're a player short for five-a-side on Thursday. You in?",
    "I'm on a late that day, sorry. Next week?",
  ),
  t(
    "Mum's birthday plans",
    "Hi Tom,\n\nShall we book the Italian place for Mum's birthday? Saturday the 18th?",
    "Yes, book it. I'll swap my shift.",
  ),
  t(
    "Holiday pics",
    "Here are the pictures from Anglesey. The weather was kind to us for once!",
    "Brilliant photos, thanks.",
  ),
  t("Quiz night", "Pub quiz on Wednesday at the Crown. Usual team?", "Count me in."),
  t(
    "Moving help next weekend?",
    "Hi,\n\nAny chance you could help me move on Saturday? Pizza and beer on me.",
    "Happy to help, I'll bring the van.",
  ),
  t(
    "Recipe for jollof",
    "Hi love,\n\nHere's the jollof recipe you asked for. Don't burn the bottom!",
    "Thanks Mum, trying it on Sunday.",
  ),
  t(
    "Concert tickets",
    "Got two spare tickets for the Apollo in December. Fancy it?",
    "Yes please! Let me know what I owe you.",
  ),
];

export interface PersonalMail extends EverydayMail {
  reply: string;
}

/** `count` messages from friends and family. */
export function personal(rnd: Random, persona: Persona, count: number): PersonalMail[] {
  const friends = persona === "maria" ? MARIA_FRIENDS : TOM_FRIENDS;
  const topics = persona === "maria" ? MARIA_TOPICS : TOM_TOPICS;
  const footer = persona === "maria" ? PERSONAL_FOOTER : PERSONAL_FOOTER_EN_GB;
  return Array.from({ length: count }, (_, i) => {
    const topic = topics[i % topics.length] as Topic;
    const from = rnd.pick(friends);
    return {
      from,
      subject: topic.subject,
      body: `${topic.body}\n\n${from.name?.split(" ")[0]}`,
      footer,
      reply: topic.reply,
    };
  });
}
