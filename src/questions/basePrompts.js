const truthBasePrompts = [
  "What is a skill you secretly want to master this year?",
  "What is one thing you overthink too much?",
  "Which habit improved your life the most recently?",
  "What is your biggest productivity weakness?",
  "What is a fear you have mostly outgrown?",
  "What is one compliment you still remember?",
  "What is a goal you keep postponing?",
  "What is one thing people misunderstand about you?",
  "What is your go-to way to calm down fast?",
  "What is your most useful life hack?",
  "What is a tiny win from this week?",
  "What is a challenge you solved in a smart way?",
  "What is one app you could not live without?",
  "What is a habit you want to quit?",
  "What is one thing you are proud of but rarely mention?",
  "What is a lesson you learned too late?",
  "What is your favorite way to spend one free hour?",
  "What is something you wish schools taught better?",
  "What is one thing you want to improve in communication?",
  "What is one thing that motivates you instantly?",
  "What is a movie scene that always hypes you up?",
  "What is a song that matches your current mood?",
  "What is your most underrated hobby?",
  "What is your favorite way to reset after a bad day?",
  "What is one useful skill everyone should learn early?",
  "What is the best advice you ignored at first?",
  "What is one thing you would teach your younger self?",
  "What is one thing you are currently learning?",
  "What is your top distraction during study or work?",
  "What is one thing that helps you focus quickly?",
  "What is your proudest team moment?",
  "What is one tiny routine that made a big difference?",
  "What is a time you surprised yourself positively?",
  "What is something simple that always makes you laugh?",
  "What is your favorite memory from this month?",
  "What is your favorite indoor activity on rainy days?",
  "What is one trend you do not understand?",
  "What is one thing you used to dislike but now enjoy?",
  "What is one underrated quality in friends?",
  "What is one thing that instantly drains your energy?",
  "What is your ideal low-stress weekend plan?",
  "What is one thing you do better under pressure?",
  "What is one thing you do worse under pressure?",
  "What is one rule you follow that helps daily life?",
  "What is your favorite way to show gratitude?",
  "What is one kind thing someone did for you recently?",
  "What is one thing you do when you need confidence?",
  "What is one time you made a smart comeback from a mistake?",
  "What is your best tip for staying consistent?",
  "What is one thing that helps you sleep better?",
  "What is one everyday item you overuse?",
  "What is one app or site you should probably use less?",
  "What is one decision you are glad you made?",
  "What is one thing you wish you started earlier?",
  "What is one thing you improved a lot in the past year?",
  "What is your favorite non-screen activity?",
  "What is your favorite way to celebrate small wins?",
  "What is one thing that always makes you curious?",
  "What is one thing you have changed your mind about?",
  "What is one topic you could talk about for hours?",
  "What is your fastest way to recover from embarrassment?",
  "What is one skill you learned from gaming?",
  "What is one skill you learned from sports?",
  "What is one skill you learned online?",
  "What is one challenge that made you more patient?",
  "What is one thing you would automate in your life?",
  "What is one healthy boundary that helped you?",
  "What is one assumption people make about you that is wrong?",
  "What is one place where you think best?",
  "What is one time you trusted your instincts and it worked?",
  "What is one thing you can do today to make tomorrow easier?",
  "What is one moment you felt genuinely brave?",
  "What is one daily task you wish took half the time?",
  "What is one thing you do that saves money?",
  "What is one thing you do that saves time?",
  "What is one random fact you enjoy sharing?",
  "What is one way you are different from your old self?",
  "What is one thing that helped your confidence recently?",
  "What is one thing you are currently grateful for?",
  "What is one thing you wish more people respected?",
  "What is one thing that should be simpler but is not?",
  "What is one way you stay positive during setbacks?",
  "What is one thing you want to finish before next month?",
  "What is one thing you do when you need quick motivation?",
  "What is one thing you learned from failing once?",
  "What is one thing you want to stop procrastinating on?",
  "What is one thing you find surprisingly difficult?",
  "What is one thing people should stop normalizing?",
  "What is one thing people should normalize more?",
  "What is one thing you always pack for a day out?",
  "What is one thing you enjoy that most people skip?",
  "What is one time you solved a problem creatively?",
  "What is one routine that keeps your week stable?",
  "What is one thing that made you laugh hard recently?",
  "What is one thing you do to protect your peace?",
  "What is one improvement you made in communication lately?",
  "What is one thing you need to simplify in your life?",
  "What is one thing you do when you need better focus?",
  "What is one thing you admire in disciplined people?",
  "What is one thing that makes teamwork easier for you?",
  "What is one quality you want to build more of?",
  "What is one thing you celebrate quietly?",
  "What is one way you recharge after social time?",
  "What is one thing you are more honest about now?",
  "What is one thing you underestimated before trying it?",
  "What is one thing you would repeat from last week?",
  "What is one thing you would do differently next week?",
  "What is one thing you are still figuring out?",
  "What is one thing you can explain really well?",
  "What is one thing you wish had a tutorial in real life?",
  "What is one good habit you learned from someone else?",
  "What is one decision framework that helps you choose faster?",
  "What is one thing you would build if you had extra free time?"
];

const dareBasePrompts = [
  "Do 20 jumping jacks and count loudly.",
  "Speak in slow motion for 45 seconds.",
  "Name 10 fruits in 20 seconds.",
  "Do your best robot dance for 20 seconds.",
  "Describe your day using only 5 words.",
  "Do a dramatic weather report for 30 seconds.",
  "Say the alphabet backward as far as you can.",
  "Hum your favorite song without naming it.",
  "Do 10 squats with perfect form.",
  "List 7 countries in under 20 seconds.",
  "Pretend to host a game show for 30 seconds.",
  "Talk like a news anchor for 1 minute.",
  "Use only movie trailer voice for your next sentence.",
  "Balance on one leg for 30 seconds.",
  "Do 15 high knees.",
  "Try to say a tongue twister 3 times quickly.",
  "Spell your name with your elbow in the air.",
  "Act like a detective solving a mystery for 30 seconds.",
  "Name 8 animals in 15 seconds.",
  "Do your best sports commentary on nothing for 30 seconds.",
  "Speak only in questions for 1 minute.",
  "Name 5 things in your room without looking around.",
  "Make a motivational speech in 20 seconds.",
  "Do a slow clap that builds to hype.",
  "Describe a sandwich like it is a luxury product.",
  "Do a one-minute posture check challenge.",
  "Count down from 30 in a dramatic voice.",
  "Name 6 colors without using blue, red, or green.",
  "Pretend your hand is a microphone and interview yourself.",
  "Do 12 lunges.",
  "Recite days of the week backward.",
  "Name 5 safe snacks in 10 seconds.",
  "Do your best superhero landing pose.",
  "Explain a pencil to an alien in 20 seconds.",
  "Do 10 calf raises slowly.",
  "Say three compliments about teamwork.",
  "Describe your favorite food with zero adjectives.",
  "Pretend to be a tour guide for your desk area.",
  "Do 20 seconds of silent dancing.",
  "Use a pirate voice for your next message.",
  "Name 7 jobs in 15 seconds.",
  "Do a no-laugh challenge for 20 seconds.",
  "Act out opening a mystery box.",
  "Say five words that rhyme with light.",
  "Do 10 arm circles forward and backward.",
  "Give a fake award acceptance speech.",
  "Explain your morning like a sports recap.",
  "Do 8 push-away wall presses.",
  "Name 10 school subjects as fast as possible.",
  "Pretend to read breaking news about pizza.",
  "Whisper dramatically for your next two lines.",
  "Spell a random object out loud and clap each letter.",
  "Do a two-step dance for 20 seconds.",
  "Name 6 cartoon characters in 15 seconds.",
  "Do 15 seconds of invisible jump rope.",
  "Act like your chair is a roller coaster ride.",
  "Say your favorite quote in three different tones.",
  "Name 5 cities starting with different letters.",
  "Do 10 seated knee raises.",
  "Pretend to sell water like a premium product.",
  "Do a mini stretching routine for 30 seconds.",
  "Speak like a wise mentor for one response.",
  "Name 9 things that are round.",
  "Do your best victory celebration.",
  "Explain a spoon in exactly 12 words.",
  "Do 10 side steps each direction.",
  "Describe your favorite game in 10 seconds.",
  "Talk like a scientist for one sentence.",
  "Name 7 words starting with S in 15 seconds.",
  "Do 30 seconds of wall sit if possible.",
  "Act like you are late to catch a train.",
  "Give a fake weather warning for today.",
  "Name 5 things you can recycle.",
  "Do 20 seconds of marching in place.",
  "Say a positive line in three accents.",
  "Pretend to narrate a cooking show intro.",
  "Name 8 indoor games in 20 seconds.",
  "Do 12 shoulder taps.",
  "Describe your keyboard like a movie hero.",
  "Do a one-minute no-filler-words challenge.",
  "Name 6 programming terms in 15 seconds.",
  "Make up a clean slogan for your day.",
  "Do your best ninja walk for 10 seconds.",
  "Act like your phone is a historical artifact.",
  "Name 7 things found in a backpack.",
  "Do 10 desk pushups if safe.",
  "Talk in third person for your next line.",
  "Describe a banana like a sci-fi tool.",
  "Do 15 seconds of fast clapping.",
  "Name 8 hobbies in 20 seconds.",
  "Do a 30-second breathing and posture reset.",
  "Pretend to host a talent show intro.",
  "Say a random fact in the most serious tone.",
  "Name 5 tools used by designers.",
  "Do 10 reverse lunges.",
  "Act out waking up for an early exam.",
  "Do your best game commentator intro.",
  "Name 6 words ending with ing quickly.",
  "Do 20 seconds of toe taps.",
  "Pretend your mug is a trophy and celebrate.",
  "Give a 15-second ad for healthy sleep.",
  "Name 5 planets in order from the sun.",
  "Do 10 gentle neck mobility circles.",
  "Speak like a podcast host for one minute.",
  "Explain your weekend in exactly 9 words.",
  "Name 6 vegetables in 15 seconds.",
  "Do 12 mountain climbers.",
  "Pretend to direct an action movie scene.",
  "Describe your favorite app with no brand name.",
  "Do 20 seconds of silent mime.",
  "Name 7 things that are yellow.",
  "Do a confidence walk across your room.",
  "Give a clean roast to your own alarm clock.",
  "Name 8 types of weather.",
  "Do 10 glute bridges if safe.",
  "Say one motivational sentence with full energy.",
  "Act like you discovered a new sport.",
  "Name 6 instruments in 15 seconds.",
  "Do 20 seconds of shadow boxing slowly.",
  "Pretend to launch your own TV show.",
  "Give a one-line TED Talk title.",
  "Name 5 board games in 10 seconds.",
  "Do 12 heel raises.",
  "Speak like a narrator for 30 seconds.",
  "Describe your shoes as if they are legendary gear.",
  "Name 7 words related to teamwork.",
  "Do a clean mic-drop motion and freeze.",
  "Say your name like a dramatic movie intro."
];

const truthTemplates = [
  {
    pattern: "What is one {adj} thing you learned from {source} this {timeframe}?",
    tokens: {
      adj: ["unexpected", "useful", "small", "valuable", "practical", "important", "surprising", "creative"],
      source: ["school", "work", "gaming", "a team project", "a mistake", "a conversation", "the internet", "daily routine", "sports", "building something"],
      timeframe: ["week", "month", "semester", "year"]
    }
  },
  {
    pattern: "Which {skill} do you want to improve most before {timeframe}?",
    tokens: {
      skill: ["communication skill", "focus skill", "planning skill", "speaking skill", "technical skill", "study skill", "leadership skill", "problem-solving skill"],
      timeframe: ["next month", "your next exam", "the next project", "summer", "the end of this year"]
    }
  },
  {
    pattern: "What is a {adj} habit you want to build for {timeframe}?",
    tokens: {
      adj: ["consistent", "healthier", "smarter", "calmer", "stronger", "simpler", "more focused", "better"],
      timeframe: ["weekday mornings", "weekends", "study hours", "teamwork", "night routine", "this month", "this year"]
    }
  },
  {
    pattern: "What is one {topic} you can explain better than most people in {place}?",
    tokens: {
      topic: ["productivity method", "gaming strategy", "learning trick", "time-saving idea", "design concept", "math shortcut", "coding concept", "communication tip"],
      place: ["your class", "your friend group", "your team", "your server", "your neighborhood"]
    }
  },
  {
    pattern: "What is one {topic} that you think should be taught earlier in {context}?",
    tokens: {
      topic: ["financial skill", "communication skill", "conflict resolution", "digital safety", "healthy routine", "critical thinking", "presentation skill", "self-management"],
      context: ["school", "college", "training programs", "new teams", "online communities"]
    }
  },
  {
    pattern: "What is your biggest {topic} challenge when you are {condition}?",
    tokens: {
      topic: ["focus", "confidence", "time management", "motivation", "consistency", "decision-making", "communication", "discipline"],
      condition: ["tired", "busy", "under pressure", "working alone", "working in a team", "learning something new", "close to a deadline"]
    }
  },
  {
    pattern: "What is one {adj} decision you made in the last {timeframe}?",
    tokens: {
      adj: ["smart", "bold", "careful", "unexpected", "mature", "efficient", "brave", "calm"],
      timeframe: ["24 hours", "3 days", "week", "2 weeks", "month"]
    }
  },
  {
    pattern: "Which {topic} do you want to simplify in your {timeframe}?",
    tokens: {
      topic: ["morning routine", "study system", "work setup", "phone usage", "task list", "sleep schedule", "exercise plan", "weekly planning"],
      timeframe: ["daily life", "weekday schedule", "next month", "next semester"]
    }
  },
  {
    pattern: "What is one {adj} thing you noticed about yourself during {context}?",
    tokens: {
      adj: ["positive", "helpful", "unexpected", "honest", "funny", "important", "useful", "growth-related"],
      context: ["a team challenge", "a busy week", "a long day", "a tough task", "a recent win", "a small failure"]
    }
  },
  {
    pattern: "What is one {topic} that instantly improves your {goal}?",
    tokens: {
      topic: ["music choice", "workspace tweak", "breathing reset", "checklist", "short walk", "hydration break", "stretch break", "focus timer"],
      goal: ["mood", "focus", "confidence", "energy", "clarity", "discipline"]
    }
  },
  {
    pattern: "What is one {topic} from {source} that changed how you think?",
    tokens: {
      topic: ["idea", "lesson", "tip", "framework", "mindset", "strategy", "rule", "insight"],
      source: ["a book", "a podcast", "a class", "a friend", "a coach", "a video", "a project"]
    }
  },
  {
    pattern: "What is one thing you want to do more consistently on {day}?",
    tokens: {
      day: ["Mondays", "weekdays", "weekends", "busy days", "exam weeks", "project days", "travel days"]
    }
  },
  {
    pattern: "What is one {topic} where you improved faster than expected?",
    tokens: {
      topic: ["public speaking", "editing", "coding", "note-taking", "gaming", "planning", "fitness", "designing", "debugging", "writing"]
    }
  },
  {
    pattern: "What is one {topic} that you avoid but should probably do more often?",
    tokens: {
      topic: ["deep work", "stretching", "budget checks", "email cleanup", "task review", "sleep routine", "daily reflection", "break planning"]
    }
  },
  {
    pattern: "What is your most {adj} strategy for handling {topic}?",
    tokens: {
      adj: ["effective", "simple", "realistic", "reliable", "quick", "healthy", "creative", "calm"],
      topic: ["stress", "deadlines", "group work", "distractions", "long tasks", "new challenges", "feedback"]
    }
  }
];

const dareTemplates = [
  {
    pattern: "Do {count} {activity} in {duration}.",
    tokens: {
      count: ["8", "10", "12", "15", "20"],
      activity: ["jumping jacks", "squats", "high knees", "toe taps", "arm circles", "marching steps", "calf raises", "wall presses"],
      duration: ["under 40 seconds", "under 1 minute", "about 45 seconds"]
    }
  },
  {
    pattern: "Name {count} {topic} in {duration}.",
    tokens: {
      count: ["5", "6", "7", "8", "10"],
      topic: ["countries", "animals", "hobbies", "board games", "cities", "vegetables", "school subjects", "instruments", "movies", "sports"],
      duration: ["10 seconds", "15 seconds", "20 seconds", "25 seconds"]
    }
  },
  {
    pattern: "Speak in a {style} voice for {duration}.",
    tokens: {
      style: ["news anchor", "sports commentator", "pirate", "robot", "movie trailer", "wise mentor", "podcast host", "science host"],
      duration: ["20 seconds", "30 seconds", "45 seconds", "1 minute"]
    }
  },
  {
    pattern: "Pretend you are a {role} and explain {topic} in {duration}.",
    tokens: {
      role: ["tour guide", "teacher", "game host", "detective", "inventor", "meteorologist", "coach", "historian"],
      topic: ["your keyboard", "a pencil", "a bottle of water", "your chair", "your favorite snack", "your desk setup", "your backpack"],
      duration: ["15 seconds", "20 seconds", "30 seconds"]
    }
  },
  {
    pattern: "Do a {style} dance for {duration}.",
    tokens: {
      style: ["robot", "slow motion", "victory", "silent", "freestyle", "comic", "two-step", "dramatic"],
      duration: ["10 seconds", "15 seconds", "20 seconds", "30 seconds"]
    }
  },
  {
    pattern: "Describe {topic} using exactly {count} words.",
    tokens: {
      topic: ["your day", "your setup", "your favorite app", "your mood", "your weekend", "your top snack", "your dream project", "your study plan"],
      count: ["7", "8", "9", "10", "12"]
    }
  },
  {
    pattern: "Do a {challenge} challenge for {duration}.",
    tokens: {
      challenge: ["no-laugh", "no-filler-word", "posture", "focus", "silent mime", "confidence walk", "tongue twister", "balance"],
      duration: ["20 seconds", "30 seconds", "45 seconds", "1 minute"]
    }
  },
  {
    pattern: "Act like you are {scenario} for {duration}.",
    tokens: {
      scenario: ["hosting a live show", "announcing breaking news", "coaching a final match", "launching a startup", "presenting an invention", "explaining a mission", "celebrating a trophy"],
      duration: ["15 seconds", "20 seconds", "30 seconds"]
    }
  },
  {
    pattern: "Give a {topic} speech in {duration}.",
    tokens: {
      topic: ["motivation", "teamwork", "healthy routine", "focus", "confidence", "discipline", "learning", "kindness"],
      duration: ["15 seconds", "20 seconds", "30 seconds", "45 seconds"]
    }
  },
  {
    pattern: "Say {count} {topic} without repeating any word.",
    tokens: {
      count: ["5", "6", "7", "8"],
      topic: ["positive words", "teamwork words", "action verbs", "study tips", "healthy habits", "productivity ideas", "design words", "coding words"]
    }
  },
  {
    pattern: "Do {count} rounds of {activity}, each for {duration}.",
    tokens: {
      count: ["2", "3", "4"],
      activity: ["fast claps", "deep breaths", "toe taps", "arm circles", "marching", "mini stretches", "slow squats"],
      duration: ["10 seconds", "15 seconds", "20 seconds"]
    }
  },
  {
    pattern: "Explain {topic} like you are talking to a {audience}.",
    tokens: {
      topic: ["time management", "a keyboard", "a backpack", "a notebook", "a game strategy", "a study plan", "healthy sleep"],
      audience: ["5-year-old", "new teammate", "future you", "alien visitor", "curious class", "busy friend", "new player"]
    }
  },
  {
    pattern: "Give a one-line ad for {topic} in a {style} style.",
    tokens: {
      topic: ["water", "sleep", "stretching", "notebooks", "teamwork", "planning", "healthy snacks", "walking"],
      style: ["luxury", "sports", "tech", "retro", "cinematic", "minimal", "motivational", "funny"]
    }
  },
  {
    pattern: "Complete this: I can improve {topic} by doing {action} for {duration}.",
    tokens: {
      topic: ["focus", "energy", "confidence", "consistency", "productivity", "discipline", "communication"],
      action: ["a quick stretch", "a short walk", "a checklist", "a breathing reset", "task batching", "phone break", "hydration"],
      duration: ["10 minutes", "15 minutes", "20 minutes", "30 minutes"]
    }
  }
];

const truthMatrix = {
  openers: [
    "What is one",
    "Tell us one",
    "Name one",
    "Share one",
    "Describe one",
    "Which",
    "What is your most",
    "What is the",
    "What was one",
    "What is a"
  ],
  subjects: [
    "small win",
    "useful habit",
    "hard lesson",
    "creative idea",
    "focus strategy",
    "confidence boost",
    "time-saving trick",
    "study routine",
    "work routine",
    "mindset shift",
    "communication improvement",
    "productivity method",
    "daily challenge",
    "goal you care about",
    "skill you want",
    "area to improve",
    "recent achievement",
    "moment of discipline",
    "thing you are proud of",
    "thing you would simplify"
  ],
  angles: [
    "from the last 24 hours",
    "from the past week",
    "from this month",
    "from your current routine",
    "from your last project",
    "from your school or work life",
    "that most people overlook",
    "that changed your perspective",
    "that helped under pressure",
    "that you want to repeat",
    "that you want to stop",
    "that helped your consistency",
    "that improved your focus",
    "that made teamwork easier",
    "that surprised you"
  ],
  timeframes: [
    "next 7 days",
    "next 2 weeks",
    "next month",
    "this semester",
    "this quarter",
    "this year"
  ],
  contexts: [
    "school",
    "work",
    "gaming",
    "fitness",
    "team projects",
    "daily routine",
    "creative work",
    "personal growth"
  ]
};

const dareMatrix = {
  actions: [
    "Do",
    "Complete",
    "Try",
    "Perform",
    "Finish",
    "Attempt"
  ],
  activities: [
    "a quick stretch sequence",
    "10 controlled squats",
    "a robot dance",
    "a dramatic countdown from 20",
    "a one-line motivational speech",
    "a no-laugh challenge",
    "a no-filler-words challenge",
    "a tongue twister run",
    "a posture check",
    "an invisible jump rope set",
    "a fast naming challenge",
    "a mini weather report",
    "a fake game show intro",
    "a victory celebration pose",
    "a quick breathing reset",
    "a march in place",
    "a narrator voice",
    "a speed list of safe words",
    "a short mime challenge",
    "a confidence walk"
  ],
  formats: [
    "while smiling",
    "with full energy",
    "in one attempt",
    "without pausing",
    "without using filler words",
    "with clear voice",
    "like a coach",
    "like a news host",
    "like a game commentator",
    "like a teacher"
  ],
  durations: [
    "for 10 seconds",
    "for 15 seconds",
    "for 20 seconds",
    "for 30 seconds",
    "for 45 seconds",
    "for 1 minute"
  ],
  addons: [
    "then give one positive sentence",
    "then share one quick reflection",
    "then say one confidence line",
    "then take a deep breath",
    "then clap once and freeze",
    "then name one thing you learned",
    "then describe your energy in 3 words",
    "then say one clean slogan",
    "then do a short salute",
    "then smile and relax"
  ]
};

module.exports = {
  truthBasePrompts,
  dareBasePrompts,
  truthTemplates,
  dareTemplates,
  truthMatrix,
  dareMatrix,
};