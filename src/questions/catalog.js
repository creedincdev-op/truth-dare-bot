const { normalizeText, sanitizePrompt } = require("../utils/textFilters");

const RATINGS = ["PG", "PG13", "R"];
const RATING_CHOICES = RATINGS.map((value) => ({ name: value, value }));

const GAME_LABELS = {
  random: "Random Mix",
  truth_or_dare: "Truth or Dare",
  truth: "Truth",
  dare: "Dare",
  never_have_i_ever: "Never Have I Ever",
  paranoia: "Paranoia",
};

const GAME_CHOICES = [
  { name: "Random Mix", value: "random" },
  { name: "Truth or Dare", value: "truth_or_dare" },
  { name: "Truth", value: "truth" },
  { name: "Dare", value: "dare" },
  { name: "Never Have I Ever", value: "never_have_i_ever" },
  { name: "Paranoia", value: "paranoia" },
];

const CATEGORY_LABELS = {
  relatable: "Relatable",
  social: "Social",
  bold: "Bold",
  chaos: "Chaos",
  confession: "Confession",
  camera: "Camera",
  voice: "Voice",
  flirty: "Flirty",
};

const CATEGORY_CHOICES = [
  { name: "Any Category", value: "any" },
  ...Object.entries(CATEGORY_LABELS).map(([value, name]) => ({ name, value })),
];

const TRUTH_OR_DARE_TYPE_CHOICES = [
  { name: "Random", value: "truth_or_dare" },
  { name: "Truth", value: "truth" },
  { name: "Dare", value: "dare" },
];

const BUTTON_MODE_CHOICES = [
  { name: "Classic", value: "classic" },
  { name: "Battle", value: "battle" },
  { name: "Streak", value: "streak" },
  { name: "Timer", value: "timer" },
];

const DEFAULT_GUILD_CONFIG = {
  defaultRating: "PG",
  maxPromptLength: 190,
  buttonTimeoutSeconds: 240,
  disabledCategories: [],
  disabledGames: [],
};

const GAME_COLORS = {
  truth: 0x25c76a,
  dare: 0xff5a66,
  never_have_i_ever: 0x5a70ff,
  paranoia: 0xe7a63f,
};

const CATEGORY_BASE_WEIGHTS = {
  relatable: 1.08,
  social: 1.05,
  confession: 1.02,
  bold: 0.97,
  camera: 1.04,
  voice: 1.0,
  chaos: 0.94,
  flirty: 0.74,
};

const TRUTH_RELATABLE_SUBJECTS = [
  "your camera roll",
  "your unread messages",
  "your sleep schedule",
  "your saved memes",
  "the excuses you use when you are late",
  "your group chat lurking",
  "your most-used emoji",
  "your note app",
  "your low-battery panic",
  "your search history of random things",
  "your screenshot habit",
  "your alarm habits",
  "your online shopping tab",
  "your snack hiding spots",
  "your reply speed",
  "your impulse purchases",
  "your fake productivity routine",
  "your overthinking after sending a message",
  "your music queue when nobody is watching",
  "your messy photo gallery",
  "the way you prepare at the last second",
  "your habit of checking notifications twice",
  "the stories you almost post and then delete",
  "your bad habit when you are bored",
  "the way you act when someone says take a picture",
  "the kind of texts you rewrite three times",
];

const TRUTH_RELATABLE_TEMPLATES = [
  "What is the most embarrassing thing about {item}?",
  "What part of {item} would roast you the hardest?",
  "What is one truth about {item} that people would never guess?",
  "What do you keep defending about {item} even though you know better?",
  "What part of {item} feels a little too real for you?",
  "What habit around {item} makes you cringe at yourself later?",
  "What about {item} do you always pretend is normal?",
  "What is the most unserious thing hiding inside {item}?",
];

const TRUTH_SOCIAL_SUBJECTS = [
  "meeting new people",
  "joining voice chat late",
  "double texting",
  "replying after leaving someone on read",
  "being the center of attention",
  "giving compliments",
  "getting roasted in a group",
  "asking for help",
  "starting conversations first",
  "ending conversations",
  "dealing with awkward silence",
  "telling someone bad news",
  "your first impression on people",
  "remembering names",
  "acting confident in public",
  "posting something and waiting for reactions",
  "saying no to plans",
  "apologizing first",
  "being ignored in chat",
  "sharing your opinion in a group",
  "staying calm in a chaotic server",
  "looking jealous without meaning to",
  "trying to act unbothered",
  "asking someone to repeat themselves",
];

const TRUTH_SOCIAL_TEMPLATES = [
  "What is your worst habit when it comes to {item}?",
  "When did {item} last backfire on you in a funny way?",
  "What do you secretly hope people do not notice about you during {item}?",
  "What is one thing you fake well during {item}?",
  "What is the most awkward version of {item} you have ever had?",
  "What do you overthink the most about {item}?",
  "What is one honest thing people get wrong about you during {item}?",
];

const TRUTH_CONFESSION_PROMPTS = [
  "What is the weakest excuse you still use when you do not want to go somewhere?",
  "What is the most unnecessary lie you have told just to avoid explaining yourself?",
  "What is something small that makes you way more annoyed than it should?",
  "What is the most embarrassing thing you have recently searched for?",
  "What is one message you typed, stared at, and never sent?",
  "What is the last thing you pretended to understand when you absolutely did not?",
  "What is something you judge people for even though you do it too?",
  "What is the most childish thing you still do when nobody is watching?",
  "What is the last reason you laughed at the wrong moment?",
  "What is one thing on your phone that would get you roasted instantly?",
  "What is the most dramatic thing you have done over a tiny problem?",
  "What is the weirdest habit you have when you are trying to focus?",
  "What is one opinion you keep quiet because you know the group would attack you for it?",
  "What is the most embarrassing way you have ever tried to look cool?",
  "What is one harmless red flag about you that your friends fully know about?",
  "What is the funniest thing you have blamed on being tired?",
  "What is one thing you do when you are jealous but trying to act normal?",
  "What is the most awkward compliment you have ever given or received?",
  "What is something you pretend not to care about but definitely do care about?",
  "What is one thing you hope people never ask to see on your phone?",
  "What is the last thing you deleted because it made you cringe?",
  "What is the most random thing you have been caught doing at exactly the wrong time?",
  "What is the silliest reason you have ever gone quiet in a chat?",
  "What is one thing you do only because you know it makes you look more put together?",
  "What is the most embarrassing thing about the way you get ready in a rush?",
  "What is something people assume you are confident about that actually stresses you out?",
  "What is the most unserious thing you have ever become competitive about?",
  "What is one habit you would absolutely hide during a first impression?",
  "What is the funniest thing you have done while pretending you were already on the way?",
  "What is one thing you remember at 2 AM and instantly regret?",
  "What is the last social situation that made you replay the whole thing in your head?",
  "What is the pettiest reason you have ever muted someone or ignored a chat?",
  "What is the last thing you secretly screenshotted just to laugh at later?",
  "What is the most embarrassing thing you have done because you thought nobody was looking?",
  "What is one truth about your online personality that is completely different from real life?",
  "What is the softest thing you have ever done that you still deny?",
  "What is one small thing that instantly exposes your mood to the people who know you well?",
  "What is the most awkward way you have tried to fix a bad first impression?",
  "What is the weirdest reason you have ever overthought a simple reply?",
  "What is the most embarrassing thing you would admit only in a game like this?",
];

const TRUTH_BOLD_SUBJECTS = [
  "someone you badly wanted to impress",
  "a message you sent with too much confidence",
  "being caught looking at someone",
  "a time you low-key wanted attention",
  "someone whose opinion affects you more than it should",
  "your most jealous moment",
  "the last time you were down bad for no reason",
  "a time you acted colder than you felt",
  "a person you would get nervous around",
  "the most dangerous amount of confidence you have ever had",
  "your biggest recent main-character moment",
  "the last time you got caught staring",
  "the most suspicious thing in your favorites",
  "the last time you wanted to look mysterious",
  "your most dramatic reaction to a late reply",
  "someone you would absolutely lose an argument to",
  "the last time you acted like you did not care when you did",
  "a moment where your ego got hit for real",
  "the hardest you have ever tried to seem unbothered",
  "the most chaotic thing you would do if there were no consequences",
];

const TRUTH_BOLD_TEMPLATES = [
  "What is the truth about {item} that you would usually never admit first?",
  "What is the funniest part about {item} if you are being brutally honest?",
  "What is the most embarrassing detail about {item}?",
  "What would expose you the fastest about {item}?",
  "What is the one thing you hope nobody connects you to about {item}?",
  "What is the boldest truth you can admit about {item} without dodging the question?",
];

const TRUTH_FLIRTY_PROMPTS = [
  "Have you ever fixed your hair or outfit because one specific person might see you?",
  "Have you ever checked if a certain person viewed your story or status?",
  "What is the most obvious thing you do when you like somebody a little?",
  "What is one small thing someone can do that instantly gets your attention?",
  "Have you ever opened a chat just to stare at it and not send anything?",
  "What is the smoothest thing you have ever said that actually worked?",
  "Have you ever acted extra funny just because one person was around?",
  "What is one compliment that would absolutely work on you?",
  "Have you ever re-read an old conversation because you liked the vibe?",
  "What is the most obvious sign that you are trying not to look interested?",
  "Have you ever posted something mainly to see if one specific person would notice?",
  "What is the most embarrassing thing you have done after getting a nice reply from someone?",
  "What kind of attention makes you fold faster than you want to admit?",
  "Have you ever looked at your own profile first before replying to someone you liked?",
  "What is one tiny thing that gives someone unexpected bonus points with you?",
  "Have you ever overanalyzed one emoji because of who sent it?",
  "What is the softest thing you have ever done after catching feelings?",
  "What is one harmless move that instantly tells people you are interested?",
];

function isSpicyRating(rating) {
  return rating === "PG13" || rating === "R";
}

function pushPrompt(buffer, seen, prompt) {
  const text = sanitizePrompt(prompt.text);
  if (!text) {
    return;
  }

  const dedupeKey = normalizeText(`${prompt.game}|${prompt.category}|${prompt.rating}|${text}`);
  if (!dedupeKey || seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  buffer.push({
    game: prompt.game,
    category: prompt.category,
    rating: prompt.rating,
    text,
    tone: prompt.tone || prompt.category,
    weight: prompt.weight || CATEGORY_BASE_WEIGHTS[prompt.category] || 1,
    tags: [...new Set(prompt.tags || [])],
  });
}

function addItemTemplates({ buffer, seen, game, category, rating, items, templates, tone = category, weight, tags = [] }) {
  for (const item of items) {
    for (const template of templates) {
      pushPrompt(buffer, seen, {
        game,
        category,
        rating,
        text: template.replace(/\{item\}/g, item),
        tone,
        weight,
        tags,
      });
    }
  }
}

function addStyleTemplates({ buffer, seen, game, category, rating, items, styles, templates, tone = category, weight, tags = [] }) {
  for (const item of items) {
    for (const style of styles) {
      for (const template of templates) {
        pushPrompt(buffer, seen, {
          game,
          category,
          rating,
          text: template.replace(/\{item\}/g, item).replace(/\{style\}/g, style),
          tone,
          weight,
          tags,
        });
      }
    }
  }
}

function addDirectPrompts({ buffer, seen, game, category, rating, prompts, tone = category, weight, tags = [] }) {
  for (const text of prompts) {
    pushPrompt(buffer, seen, {
      game,
      category,
      rating,
      text,
      tone,
      weight,
      tags,
    });
  }
}
const DARE_CAMERA_TARGETS = [
  "your hand",
  "your shoes",
  "your desk",
  "the nearest snack",
  "your water bottle or cup",
  "the view from where you are sitting",
  "something blue near you",
  "something red near you",
  "your keyboard",
  "the messiest corner you can reach",
  "the cleanest corner you can find",
  "your bag or backpack",
  "the item closest to your left hand",
  "the oldest random thing on your table",
  "your favorite small object nearby",
  "the funniest thing within arm's reach",
  "your current lighting setup",
  "a page of your handwriting",
  "your earphones or headset",
  "your watch, bracelet, or ring if you have one",
  "the most suspicious item near you",
  "the most useful thing on your table",
  "the nearest soft thing",
  "the nearest green object",
  "your phone case reflected in a mirror if possible",
  "the coolest texture near you",
  "your sleeve or hoodie detail",
  "the last thing you touched",
  "the calmest-looking object in the room",
  "your favorite pair of slippers or socks if nearby",
];

const DARE_CAMERA_TEMPLATES = [
  "Take a quick photo of {item} and send it here.",
  "Post a photo of {item} with zero explanation.",
  "Take the cleanest possible photo of {item} and drop it in chat.",
  "Send a picture of {item} like it deserves a product ad.",
];

const DARE_CAMERA_ROLL_PROMPTS = [
  "Send a random photo from your camera roll that is safe to share and give it a dramatic title.",
  "Post the 7th photo in your camera roll if it is safe, or the next safe one after it.",
  "Send the last photo you took of an object, not a person, and do not explain it for 10 seconds.",
  "Post one photo from your camera roll that has perfect meme energy.",
  "Send a photo from your gallery that feels way more serious than it should.",
  "Drop a safe photo from your camera roll that would confuse people without context.",
  "Send a photo you actually like from your camera roll and let the chat caption it.",
  "Post a safe photo from your gallery that somehow represents your personality today.",
  "Send a safe photo from your camera roll that you forgot existed.",
  "Drop a photo from your gallery that looks like it has a backstory, even if it does not.",
  "Send the oldest safe photo you can find in 20 seconds.",
  "Post a photo from your camera roll that feels unnecessarily cinematic.",
  "Send a safe zoomed-in photo from your gallery and let the chat guess what it is.",
  "Post a safe photo that would make a strange album cover.",
  "Send a safe photo you would never normally post but can survive posting once.",
];

const DARE_SOCIAL_ACTIONS = [
  "send a one-line compliment to the next person who types",
  "describe your mood using only three emojis and one word",
  "write a fake breaking-news headline about your own day",
  "drop the most dramatic status update you can think of in one sentence",
  "say one nice thing about yourself out loud or in chat",
  "send a message that starts with 'Update:' and make it completely about something tiny",
  "admit your current energy in exactly five words",
  "type a fake warning label for yourself",
  "write a short review of your day like it is a bad movie",
  "describe the last thing you ate like a luxury experience",
  "rename your mood as if it were a playlist title",
  "write a fake apology to your alarm clock",
  "post a two-line speech as if you just won an award for overthinking",
  "describe yourself like a suspicious item on a shopping site",
  "type your current vibe like it is patch notes",
  "send the most honest one-line weather report for your brain",
  "drop a fake ad for your personality",
  "make a three-word slogan for your life today",
  "explain your current mood like a customer support ticket",
  "write a one-line threat to your own procrastination",
  "post a fake mission statement for the next ten minutes of your life",
  "drop a headline that sounds like your camera roll has leaked",
  "write your current confidence level like a game stat",
  "describe your attention span as if it were a product review",
];

const DARE_SOCIAL_TEMPLATES = [
  "{item} right now.",
  "Do this now: {item}.",
  "For this dare, {item}.",
];

const DARE_VOICE_SCENARIOS = [
  "your day so far",
  "why your alarm is your mortal enemy",
  "the snack you would defend in court",
  "the most dramatic thing that happened to you this week",
  "your favorite lazy excuse",
  "why your camera roll deserves privacy",
  "what makes group chats dangerous",
  "the nearest object to you",
  "why your room should be in a documentary",
  "the last thing that made you laugh",
  "why being on time is a myth",
  "what your mood would sound like as a trailer",
  "why your phone battery is always fighting for its life",
  "your main-character moment from today",
  "why your overthinking deserves a trophy",
  "the weirdest detail in the room",
];

const DARE_VOICE_STYLES = [
  "a movie trailer voice",
  "a late-night radio host",
  "breaking news",
  "a sports commentator",
  "a villain monologue",
  "a dramatic school principal",
  "a wedding speech",
  "an angry coach",
  "a motivational speaker",
  "someone narrating a wildlife documentary",
];

const DARE_VOICE_TEMPLATES = [
  "Send a voice note about {item} in the style of {style}.",
  "Describe {item} like you are {style}.",
  "Give a 15-second voice-note speech on {item} as {style}.",
];

const DARE_PERFORMANCE_ACTIONS = [
  "pretend you just got exposed for nothing and must defend yourself",
  "give a victory speech for winning absolutely nothing",
  "act like your chair is interviewing you",
  "sell an invisible product with full confidence",
  "do a fake apology tour for being late in your own head",
  "act like someone just leaked your most-used emoji",
  "pretend your water bottle has trust issues with you",
  "introduce yourself like you are a final boss",
  "pretend the floor is a red carpet and you are arriving late",
  "give a TED Talk on why your attention span deserves respect",
  "react like the chat just found your hidden talent",
  "act like your phone is filing a complaint about you",
  "do a dramatic goodbye to your last bit of motivation",
  "pretend you are being interviewed after surviving a normal day",
  "narrate your next ten seconds like a serious documentary",
  "act like you are explaining a crime scene made entirely of snacks",
  "turn your last minor inconvenience into a legendary story",
  "explain why you deserve better luck today",
  "react as if a random object near you just betrayed you",
  "give a motivational speech to your future self for the next hour",
];

const DARE_PERFORMANCE_TEMPLATES = [
  "For 20 seconds, {item}.",
  "Do this with full commitment: {item}.",
  "Take this dare seriously for one moment and {item}.",
];

const DARE_FLIRTY_PROMPTS = [
  "Send a safe selfie angle or hand pic that looks way more confident than you feel.",
  "Drop one line that sounds smooth, then immediately admit it was a dare.",
  "Describe your ideal first-text energy in exactly six words.",
  "Send the most harmlessly suspicious emoji combo you can think of.",
  "Type one compliment that would absolutely work on you.",
  "Post the most confident safe photo you can take in 20 seconds.",
  "Write a fake flirty movie title about your current mood.",
  "Send a one-line dating-app bio for your sleep schedule.",
  "Describe your type using only safe, funny clues.",
  "Drop a line that sounds smooth without using the words cute, hot, or pretty.",
  "Post a safe picture of your hand like it deserves a fan page.",
  "Write the most harmlessly dangerous two-word text opener you can think of.",
];

const NHIE_RELATABLE_BEHAVIORS = [
  "opened a message and then spent way too long thinking of the reply",
  "said 'on my way' while still getting ready",
  "re-read my own message to see if it sounded weird",
  "screenshotted something only because it was too funny to lose",
  "pretended I knew what was going on in a group plan",
  "typed a full reply and then deleted all of it",
  "checked if someone saw my story faster than I should admit",
  "watched the same video twice because I forgot to pay attention the first time",
  "changed my mind about posting something at the very last second",
  "opened the fridge, forgot why, and still acted like I had a plan",
  "kept refreshing an app like something new would magically appear",
  "set an alarm and ignored it like it was a suggestion",
  "saved a meme instantly because it felt too specific to me",
  "pretended not to care and then thought about it all day",
  "said I was fine and then made it obvious I was not",
  "looked for my phone while it was in my hand",
  "started cleaning only because I had something else to do",
  "joined a conversation late and acted like I understood everything",
  "left a chat muted and still checked it every hour",
  "laughed at something at the worst possible moment",
  "rewrote a caption three times and still hated it",
  "opened a note app just to vent to myself",
  "looked at old photos and got hit by instant embarrassment",
  "pretended a typo was intentional",
  "stared at the member list for absolutely no reason",
  "taken forever to choose a reaction emoji",
  "listened to the same song on loop until it lost all meaning",
  "clicked a notification so fast that I regretted it immediately",
  "let one awkward moment ruin my whole hour",
  "acted busy just to avoid a conversation",
  "planned a whole fake scenario in my head from one small interaction",
  "got annoyed by something tiny and then knew I was being dramatic",
  "watched someone typing and still panicked about the reply",
  "said 'I am almost done' when I had barely started",
  "saved something to watch later and never watched it",
  "opened an app and instantly forgot what I came there for",
  "looked at my own profile just to see how it looked",
  "rehearsed a casual sentence in my head before saying it",
  "accidentally made eye contact and looked away like it was illegal",
  "sent a message and wanted to throw my phone for the next minute",
  "checked the time and instantly got more stressed",
  "pretended I was chill while clearly not being chill",
  "looked for motivation and found snacks instead",
  "kept one tab open for so long it became part of the furniture",
  "forgotten why I walked into a room and still refused to leave",
  "judged a situation instantly and then changed my mind five minutes later",
  "opened a conversation just to feel something and then closed it again",
  "told myself I would sleep early and then fully betrayed that plan",
  "saved a photo just because it matched my exact mood",
  "watched my own story after posting it",
  "opened a chat to reply, got distracted, and came back way too late",
  "looked at my own message after sending it and instantly found a problem",
  "used one word because I could not handle thinking of a better reply",
  "pretended I did not see a message when I absolutely saw it",
  "taken a picture, hated it, retaken it, and still used the first one",
  "started overthinking because someone replied faster than usual",
  "kept one embarrassing tab open for way longer than needed",
  "looked busy on purpose because I did not want to explain my mood",
  "checked my hair or outfit in my front camera for no real reason",
  "typed a confident reply and then replaced it with something safer",
  "used humor to dodge a normal question",
  "replayed one tiny awkward moment all day",
  "kept refreshing a chat because I was bored and nosy",
];

const NHIE_BOLD_BEHAVIORS = [
  "acted way more confident than I actually felt",
  "checked if someone specific was online more than once",
  "pretended not to notice attention that I absolutely noticed",
  "acted mysterious when I really just had nothing to say",
  "got jealous over something small and harmless",
  "liked the idea of being a little hard to read",
  "replayed one compliment in my head longer than necessary",
  "changed my vibe just because certain people were around",
  "acted cooler in text than I would in real life",
  "tried to look unbothered while fully being bothered",
  "kept talking about something mainly because one person was listening",
  "felt exposed by an extremely normal question",
  "got nervous from one unexpectedly good reply",
  "pretended a little chaos was totally under control",
  "been too proud to send the obvious text first",
  "tried to sound casual while definitely not feeling casual",
  "acted uninterested because I did not want to look too obvious",
  "checked my own profile picture after getting attention from someone",
  "acted brave in the group and folded in private",
  "wanted to look cool and accidentally looked way too serious",
  "been more affected by one message than I should admit",
  "kept a straight face while my brain was doing too much",
  "got humbled by one simple question",
  "acted like I was not waiting for a reply when I absolutely was",
];

const NHIE_FLIRTY_BEHAVIORS = [
  "fixed my hair or outfit because one specific person might see me",
  "checked a chat twice just because I liked who sent it",
  "posted something mainly hoping one person would notice",
  "overanalyzed an emoji because of who used it",
  "opened an old conversation just because the vibe was good",
  "acted funnier than usual because someone interesting was around",
  "looked at my own profile before replying to someone I liked",
  "saved a harmless compliment because it hit harder than expected",
  "tried to act less interested than I actually was",
  "re-read a nice message more than once because it made me smile",
];
const PARANOIA_ACTIONS = [
  "panic first if their phone was handed around for two minutes",
  "type a risky message and delete it before sending",
  "check who viewed their story or status first",
  "say 'I am chill' while clearly not being chill",
  "get caught staring and deny it instantly",
  "have the funniest camera roll explanation ready",
  "pretend to be low-maintenance and still overthink everything",
  "get exposed by their own screenshots",
  "accidentally start drama just by reacting wrong",
  "fall for a bold compliment the fastest",
  "leave a voice note and replay it with regret",
  "be the hardest to read in a simple conversation",
  "act innocent after doing something obviously chaotic",
  "get nervous from a message that should not be that serious",
  "know exactly who they would text first after leaving this chat",
  "have the most suspiciously organized favorites or saved folder",
  "pretend not to care and then care the most",
  "be secretly pleased by attention while acting above it",
  "need the longest time to choose one photo to send",
  "have a secret main-character playlist for specific moods",
  "react the loudest to getting mildly exposed",
  "be the quickest to mute a chat and still stalk it",
  "have a person in mind right now and deny it badly",
  "look the calmest while hiding the most chaos",
  "win a flirting contest by accident",
  "fold first if someone actually matched their energy",
  "have the funniest private notes app entries",
  "ghost a conversation and then return like nothing happened",
  "send the best fake 'I just woke up' text",
  "have the most dangerous level of confidence on the right day",
  "get caught smiling at their phone and fail to explain it",
  "remember every tiny detail and pretend they do not",
  "take the longest to answer because they are crafting the perfect reply",
  "act like they hate attention and then post the cleanest selfie",
  "low-key enjoy being a little mysterious",
];

const PARANOIA_TEMPLATES = [
  "Who here is most likely to {item}?",
  "Who here would {item} and still act innocent after it?",
  "Who here could {item} and somehow get away with it the longest?",
];

const PARANOIA_DIRECT_PROMPTS = [
  "Who here probably has one person in mind right now?",
  "Who here would panic the hardest if everyone swapped phones for two minutes?",
  "Who here would be the hardest to expose even if they were guilty?",
  "Who here acts the most unbothered while overthinking the most?",
  "Who here would deliver the smoothest line by pure accident?",
  "Who here would absolutely deny liking attention while clearly loving it?",
  "Who here would have the funniest explanation if their camera roll leaked one safe photo at a time?",
  "Who here is most likely to see a risky text, smile, and pretend it meant nothing?",
  "Who here would fumble the easiest after one really good reply?",
  "Who here would secretly enjoy being picked for this question the most?",
  "Who here would be the most dangerous with full confidence and no supervision?",
  "Who here probably has the most chaotic private drafts right now?",
  "Who here would low-key become softer the fastest with the right person?",
  "Who here would absolutely know how to look calm while hiding panic?",
  "Who here would be the first to act like the question is dumb while still taking it personally?",
  "Who here would have the best answer but never say it out loud?",
  "Who here seems the most innocent but definitely has the boldest inner monologue?",
  "Who here would fold first if someone actually matched their energy?",
  "Who here would make the strongest first impression and then overthink it later?",
  "Who here is most likely to keep one tiny moment in their head for way too long?",
  "Who here would know exactly who this question is about before anyone else does?",
  "Who here would pretend not to be nervous while obviously being nervous?",
  "Who here would handle a risky compliment the worst in the funniest way?",
  "Who here would be most likely to have a full storyline in their head from one look?",
  "Who here would be the easiest to expose with one well-aimed question?",
  "Who here would accidentally reveal too much with one facial expression?",
  "Who here would be the most likely to screenshot this and deny it later?",
  "Who here would be the worst at pretending they do not have a favorite person here?",
  "Who here would be the first to catch a vibe and pretend it means nothing?",
  "Who here would have the biggest reaction to being guessed correctly?",
  "Who here would act offended by this question and then think about it all night?",
  "Who here would know exactly who is being talked about from one clue?",
  "Who here would make the cleanest public image while hiding the messiest private thoughts?",
  "Who here would low-key enjoy the attention from a question like this the most?",
  "Who here would be the fastest to deny something that is a little too accurate?",
  "Who here would fumble hardest if the chat guessed their person correctly?",
  "Who here would have the funniest answer if everyone could read their mind for five seconds?",
];

function buildTruthPrompts(rating) {
  const prompts = [];
  const seen = new Set();

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "truth",
    category: "relatable",
    rating,
    items: TRUTH_RELATABLE_SUBJECTS,
    templates: TRUTH_RELATABLE_TEMPLATES,
    tone: "relatable",
    weight: 1.12,
    tags: ["truth", "relatable"],
  });

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "truth",
    category: "social",
    rating,
    items: TRUTH_SOCIAL_SUBJECTS,
    templates: TRUTH_SOCIAL_TEMPLATES,
    tone: "social",
    weight: 1.06,
    tags: ["truth", "social"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "truth",
    category: "confession",
    rating,
    prompts: TRUTH_CONFESSION_PROMPTS,
    tone: "confession",
    weight: 1.02,
    tags: ["truth", "confession"],
  });

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "truth",
    category: "bold",
    rating,
    items: TRUTH_BOLD_SUBJECTS,
    templates: TRUTH_BOLD_TEMPLATES,
    tone: "bold",
    weight: 0.97,
    tags: ["truth", "bold"],
  });

  if (isSpicyRating(rating)) {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "truth",
      category: "flirty",
      rating,
      prompts: TRUTH_FLIRTY_PROMPTS,
      tone: "flirty",
      weight: 0.76,
      tags: ["truth", "flirty"],
    });
  }

  if (rating === "R") {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "truth",
      category: "bold",
      rating,
      prompts: [
        "What is the most suspiciously confident thing you have ever done just because the vibe felt right?",
        "What is one truth about your ego that your friends would instantly agree with?",
        "What is the boldest harmless move you almost made recently?",
        "What is the last time your face gave away way more than your words did?",
        "What is the most reckless harmless thought you have had in the last week?",
        "What is something you would only admit in a game because it sounds worse out loud?",
      ],
      tone: "bold",
      weight: 0.93,
      tags: ["truth", "bold", "late-night"],
    });
  }

  return prompts;
}

function buildDarePrompts(rating) {
  const prompts = [];
  const seen = new Set();

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "dare",
    category: "camera",
    rating,
    items: DARE_CAMERA_TARGETS,
    templates: DARE_CAMERA_TEMPLATES,
    tone: "camera",
    weight: 1.12,
    tags: ["dare", "photo", "camera"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "dare",
    category: "camera",
    rating,
    prompts: DARE_CAMERA_ROLL_PROMPTS,
    tone: "camera",
    weight: 1.08,
    tags: ["dare", "gallery", "camera"],
  });

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "dare",
    category: "social",
    rating,
    items: DARE_SOCIAL_ACTIONS,
    templates: DARE_SOCIAL_TEMPLATES,
    tone: "social",
    weight: 1.03,
    tags: ["dare", "social"],
  });

  addStyleTemplates({
    buffer: prompts,
    seen,
    game: "dare",
    category: "voice",
    rating,
    items: DARE_VOICE_SCENARIOS,
    styles: DARE_VOICE_STYLES,
    templates: DARE_VOICE_TEMPLATES,
    tone: "voice",
    weight: 1.0,
    tags: ["dare", "voice"],
  });
  addItemTemplates({
    buffer: prompts,
    seen,
    game: "dare",
    category: "chaos",
    rating,
    items: DARE_PERFORMANCE_ACTIONS,
    templates: DARE_PERFORMANCE_TEMPLATES,
    tone: "chaos",
    weight: 0.96,
    tags: ["dare", "performance", "chaos"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "dare",
    category: "bold",
    rating,
    prompts: [
      "Reveal your top three most-used emojis and let the chat judge the vibe.",
      "Take a safe photo of your current expression and post it with the caption 'caught in 4K'.",
      "Type your last thought as if it were a movie trailer line.",
      "Post a one-line fake diary entry for the exact mood you are in right now.",
      "Send the best photo you can take of your sleeve, watch, bracelet, or ring in 20 seconds.",
      "Write a two-line speech as if your phone just betrayed you publicly.",
      "Describe the room around you like it is a luxury listing, even if it absolutely is not.",
      "Drop a photo of the nearest object that would win a personality contest.",
      "Post the safest random picture you can take right now that somehow still looks suspicious.",
      "Type a fake emergency alert for your current energy level.",
      "Send a harmlessly dramatic text to the chat starting with 'I need everyone to stay calm'.",
      "Post a picture of your handwriting spelling one word: chaotic.",
      "Send the cleanest photo of your hand like it belongs in a magazine ad.",
      "Take a photo of the nearest thing that says too much about you and post it.",
      "Write a one-line review of your own vibe right now with a star rating.",
      "Send a photo of the weirdest safe thing you can spot in ten seconds.",
      "Post a fake update note about your brain like it is buggy software.",
      "Describe the last five minutes of your life like a sports commentator.",
    ],
    tone: "bold",
    weight: 1.0,
    tags: ["dare", "bold"],
  });

  if (isSpicyRating(rating)) {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "dare",
      category: "flirty",
      rating,
      prompts: DARE_FLIRTY_PROMPTS,
      tone: "flirty",
      weight: 0.76,
      tags: ["dare", "flirty"],
    });
  }

  if (rating === "R") {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "dare",
      category: "bold",
      rating,
      prompts: [
        "Send the safest photo you can take that still looks like it has a story nobody is ready for.",
        "Write the smoothest harmless one-liner you can and let the chat score it.",
        "Post the most confident safe angle you can manage in one shot.",
        "Describe your current vibe as if you are walking into a scene way too late but still owning it.",
        "Type the most suspicious harmless status update you can think of in one sentence.",
      ],
      tone: "bold",
      weight: 0.95,
      tags: ["dare", "bold", "late-night"],
    });
  }

  return prompts;
}

function buildNeverHaveIEverPrompts(rating) {
  const prompts = [];
  const seen = new Set();

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "never_have_i_ever",
    category: "relatable",
    rating,
    prompts: NHIE_RELATABLE_BEHAVIORS.map((item) => `Never have I ever ${item}.`),
    tone: "relatable",
    weight: 1.08,
    tags: ["nhie", "relatable"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "never_have_i_ever",
    category: "bold",
    rating,
    prompts: NHIE_BOLD_BEHAVIORS.map((item) => `Never have I ever ${item}.`),
    tone: "bold",
    weight: 0.97,
    tags: ["nhie", "bold"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "never_have_i_ever",
    category: "social",
    rating,
    prompts: [
      "Never have I ever pretended to laugh just to avoid making a moment awkward.",
      "Never have I ever opened a chat only to see if something changed.",
      "Never have I ever acted like I was busy just to delay a reply.",
      "Never have I ever gone quiet in a group because I suddenly got self-conscious.",
      "Never have I ever sent a message and immediately wished I could rewind time.",
      "Never have I ever tried to look chill while clearly panicking inside.",
      "Never have I ever re-checked how I looked before sending a photo or joining a call.",
      "Never have I ever replied with a dry message because I overthought too hard.",
      "Never have I ever kept stalking a muted chat just because I wanted the drama updates.",
      "Never have I ever acted like I understood the plan and hoped it would work out anyway.",
      "Never have I ever let one weird interaction mess with my whole mood.",
      "Never have I ever looked at the member list for reasons I cannot explain.",
      "Never have I ever typed a whole paragraph and replaced it with 'lol'.",
      "Never have I ever overprepared for something tiny and still felt unready.",
      "Never have I ever kept a harmless screenshot because the timing was just too good.",
    ],
    tone: "social",
    weight: 1.02,
    tags: ["nhie", "social"],
  });

  if (isSpicyRating(rating)) {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "never_have_i_ever",
      category: "flirty",
      rating,
      prompts: NHIE_FLIRTY_BEHAVIORS.map((item) => `Never have I ever ${item}.`),
      tone: "flirty",
      weight: 0.76,
      tags: ["nhie", "flirty"],
    });
  }

  return prompts;
}

function buildParanoiaPrompts(rating) {
  const prompts = [];
  const seen = new Set();

  addItemTemplates({
    buffer: prompts,
    seen,
    game: "paranoia",
    category: "social",
    rating,
    items: PARANOIA_ACTIONS,
    templates: PARANOIA_TEMPLATES,
    tone: "social",
    weight: 1.05,
    tags: ["paranoia", "social"],
  });

  addDirectPrompts({
    buffer: prompts,
    seen,
    game: "paranoia",
    category: "bold",
    rating,
    prompts: PARANOIA_DIRECT_PROMPTS,
    tone: "bold",
    weight: 1.0,
    tags: ["paranoia", "bold"],
  });

  if (isSpicyRating(rating)) {
    addDirectPrompts({
      buffer: prompts,
      seen,
      game: "paranoia",
      category: "flirty",
      rating,
      prompts: [
        "Who here would catch feelings first and then pretend it was just a joke?",
        "Who here would overanalyze one good reply the longest?",
        "Who here would fold the fastest after one properly timed compliment?",
        "Who here would act the coolest while clearly being the most interested?",
        "Who here probably has the smoothest harmless opener saved in their brain right now?",
        "Who here would replay one nice conversation in their head for days?",
        "Who here would notice a subtle vibe shift before everyone else?",
        "Who here would have the strongest game until it actually mattered?",
      ],
      tone: "flirty",
      weight: 0.78,
      tags: ["paranoia", "flirty"],
    });
  }

  return prompts;
}

function addPromptMetadata(prompt) {
  const key = normalizeText(`${prompt.game}|${prompt.category}|${prompt.rating}|${prompt.text}`);
  return {
    ...prompt,
    key,
  };
}

function buildPromptCatalog() {
  const prompts = [];

  for (const rating of RATINGS) {
    prompts.push(...buildTruthPrompts(rating));
    prompts.push(...buildDarePrompts(rating));
    prompts.push(...buildNeverHaveIEverPrompts(rating));
    prompts.push(...buildParanoiaPrompts(rating));
  }

  return prompts.map(addPromptMetadata);
}

function isInternalPlayableGame(game) {
  return ["truth", "dare", "never_have_i_ever", "paranoia"].includes(game);
}

module.exports = {
  BUTTON_MODE_CHOICES,
  CATEGORY_CHOICES,
  CATEGORY_LABELS,
  DEFAULT_GUILD_CONFIG,
  GAME_CHOICES,
  GAME_COLORS,
  GAME_LABELS,
  RATINGS,
  RATING_CHOICES,
  TRUTH_OR_DARE_TYPE_CHOICES,
  buildPromptCatalog,
  isInternalPlayableGame,
};
