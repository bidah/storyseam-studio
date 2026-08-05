// Spanish (Español) dictionary. Keys are the exact English source strings; the
// value is the Spanish translation. A string with no entry here falls back to
// its English key (see src/lib/i18n.jsx), so this file can grow incrementally.
//
// Keep `{token}` interpolation placeholders identical to the English key.
// Grouped by surface for readability; the runtime treats it as one flat map.
export const es = {
  // ── App shell / navigation (RootLayout) ──────────────────────────────
  "World": "Mundo",
  "Moodboard": "Panel de inspiración",
  "Script": "Guion",
  "Shot list": "Lista de tomas",
  "Radio": "Radio",
  "Animatic": "Animática",
  "Shots": "Tomas",
  "Multi-shot": "Multi-toma",
  "Episode (48)": "Episodio (48)",
  "Complete cuts": "Cortes completos",
  "Editor": "Editor",
  "Library": "Biblioteca",
  "Sound studio": "Estudio de sonido",
  "Refresh": "Actualizar",
  "Account menu": "Menú de cuenta",
  "Higgsfield account": "Cuenta de Higgsfield",
  "Settings": "Ajustes",
  "Team & access": "Equipo y acceso",
  "Light mode": "Modo claro",
  "Dark mode": "Modo oscuro",
  "Visit higgsfield.ai": "Visitar higgsfield.ai",
  "Sign out": "Cerrar sesión",

  // ── Settings — Language panel ────────────────────────────────────────
  "Language": "Idioma",
  "Choose the language for the studio interface. Your choice is saved in this browser.":
    "Elige el idioma de la interfaz del estudio. Tu elección se guarda en este navegador.",
  "Interface language": "Idioma de la interfaz",
  "English": "Inglés",
  "Spanish": "Español",

  // ── Members / Team & access (scopeSummary + roster) ─────────────────
  "Owner · full access": "Propietario · acceso total",
  "Admin · all projects": "Admin · todos los proyectos",
  "All projects": "Todos los proyectos",
  "{n} projects": "{n} proyectos",
  "No projects yet": "Aún sin proyectos",

  // ── Written world (World route) ────────────────────────────────────
  "World creation": "Creación del mundo",
  "The world that makes the series — define it here before you write the script.":
    "El mundo que define la serie: defínelo aquí antes de escribir el guion.",
  "agent working…": "el agente está trabajando…",
  "Let's create the world": "Creemos el mundo",
  "press “Let's create the world” to have the agent interview you, or fill any field in directly.":
    "Pulsa «Creemos el mundo» para que el agente te entreviste, o rellena cualquier campo directamente.",
  "story map": "mapa de la historia",
  "story depth": "profundidad de la historia",
  "characters": "personajes",
  "locations": "localizaciones",
  "Save failed": "No se pudo guardar",

  "The series": "La serie",
  "Title": "Título",
  "Untitled world": "Mundo sin título",
  "Logline": "Logline",
  "One sentence that captures the series.": "Una frase que resuma la serie.",

  "Story map": "Mapa de la historia",
  "1. What is the world of your story?": "1. ¿Cuál es el mundo de tu historia?",
  "Where is it taking place?": "¿Dónde transcurre?",
  "2. Who is the protagonist?": "2. ¿Quién es el protagonista?",
  "What is their main goal?": "¿Cuál es su objetivo principal?",
  "3. Who or what is the antagonist?": "3. ¿Quién o qué es el antagonista?",
  "The force standing in the way.": "La fuerza que se interpone en el camino.",
  "4. What is the stake if they fail?": "4. ¿Qué está en juego si fracasan?",
  "What is lost if the goal isn't met?": "¿Qué se pierde si no se cumple el objetivo?",
  "5. What theme or message is driving the story?": "5. ¿Qué tema o mensaje impulsa la historia?",
  "The idea underneath it all.": "La idea que subyace a todo.",

  "Story depth": "Profundidad de la historia",
  "Understand the story — the core elements beneath the plot.":
    "Comprende la historia: los elementos esenciales que hay bajo la trama.",
  "Premise": "Premisa",
  "What is the story really about? Beyond the plot, what's the deeper message?":
    "¿De qué trata realmente la historia? Más allá de la trama, ¿cuál es el mensaje más profundo?",
  "Character development": "Desarrollo de personaje",
  "What they want vs. what they need.": "Lo que quieren frente a lo que necesitan.",
  "Conflict & stakes": "Conflicto y lo que está en juego",
  "Why should the audience care what these characters are going through?":
    "¿Por qué debería importarle al público lo que atraviesan estos personajes?",
  "Obstacles & consequences": "Obstáculos y consecuencias",
  "The obstacles the protagonist faces — and what happens if they fail.":
    "Los obstáculos a los que se enfrenta el protagonista y qué ocurre si fracasa.",
  "Story structure": "Estructura de la historia",
  "How the story is shaped (the arc / beats).":
    "Cómo se moldea la historia (el arco / los latidos).",

  "Characters": "Personajes",
  "Add character": "Añadir personaje",
  "no characters yet — add one, or let the agent build the roster.":
    "Aún no hay personajes: añade uno o deja que el agente construya el reparto.",
  "Locations": "Localizaciones",
  "Add location": "Añadir localización",
  "no locations yet — add the places your shots happen in so scenes get a consistent background.":
    "Aún no hay localizaciones: añade los lugares donde ocurren tus tomas para que las escenas tengan un fondo coherente.",
  "Remove character": "Eliminar personaje",
  "Remove location": "Eliminar localización",
  "Remove “{name}” from the world? This can't be undone.":
    "¿Eliminar «{name}» del mundo? Esta acción no se puede deshacer.",
  "this character": "este personaje",
  "this location": "esta localización",
  "Failed to load": "No se pudo cargar",

  // ── Written world — character fields (CHAR_FIELDS) ─────────────────
  "Type / archetype": "Tipo / arquetipo",
  "Protagonist, mentor, foil…": "Protagonista, mentor, contrapunto…",
  "Role in the story": "Rol en la historia",
  "What they do in the plot": "Lo que hacen en la trama",
  "Want": "Deseo",
  "Their conscious goal": "Su objetivo consciente",
  "Need": "Necesidad",
  "What they actually need": "Lo que realmente necesitan",
  "Traits & personality": "Rasgos y personalidad",
  "Bright, playful, stubborn…": "Vivaz, juguetón, terco…",
  "Arc": "Arco",
  "How they change": "Cómo cambian",
  "Voice": "Voz",
  "How they speak": "Cómo hablan",
  "Appearance": "Apariencia",
  "Look / design notes": "Aspecto / notas de diseño",

  // ── Written world — character / location cards + voice picker ──────
  "Character name": "Nombre del personaje",
  "Remove {name}": "Eliminar {name}",
  "character": "personaje",
  "{name} sheet": "Ficha de {name}",
  "View full image": "Ver imagen completa",
  "Change character sheet": "Cambiar ficha de personaje",
  "Link character sheet": "Vincular ficha de personaje",
  "Attach voice": "Adjuntar voz",
  "Change voice": "Cambiar voz",
  "Location name": "Nombre de la localización",
  "location": "localización",
  "Slug": "Slug",
  "Change location sheet": "Cambiar ficha de localización",
  "Link location sheet": "Vincular ficha de localización",
  "Description": "Descripción",
  "What the place looks like — keep it consistent across scenes.":
    "Cómo es el lugar: mantenlo coherente entre escenas.",
  "Unlink": "Desvincular",

  "Expand": "Expandir",
  "Expand {title}": "Expandir {title}",
  "section": "sección",
  "Attach a voice": "Adjuntar una voz",
  "Your liked voices from the Sound Studio — like a voice take on the Sounds tab to see it here.":
    "Tus voces favoritas del estudio de sonido: marca una toma de voz como favorita en la pestaña Sonidos para verla aquí.",
  "Search liked voices…": "Buscar voces favoritas…",
  "no liked voices yet — generate a voice on the Sounds tab and tap the heart to like a take.":
    "Aún no hay voces favoritas: genera una voz en la pestaña Sonidos y toca el corazón para marcar una toma como favorita.",
  "Select": "Seleccionar",
  "Untitled voice": "Voz sin título",

  // ── Script agents (World › Script agents board) ────────────────────
  "Script agents": "Agentes de guion",
  "The writers' room: who has read your script, what they said, and what you haven't run yet.":
    "La sala de guionistas: quién ha leído tu guion, qué dijo y qué te falta por lanzar.",
  "Open the script": "Abrir el guion",
  "Go to the Script tab": "Ir a la pestaña Guion",
  "{n} of {total} have read this revision": "{n} de {total} han leído esta revisión",
  "{n} lines": "{n} líneas",
  "{n} stale": "{n} desactualizados",
  "{n} never run": "{n} sin ejecutar",
  "{n} passes in total": "{n} pasadas en total",
  "there's no script yet — write one on the Script tab and the room can start reading it.":
    "Aún no hay guion: escribe uno en la pestaña Guion y la sala podrá empezar a leerlo.",
  "the review ledger couldn't be read, so nobody's passes can be shown.":
    "No se pudo leer el registro de revisiones, así que no se pueden mostrar las pasadas de nadie.",

  // Card states + disclosures
  "Read this revision": "Ha leído esta revisión",
  "Script changed since": "El guion cambió desde entonces",
  "Never run": "Nunca ejecutado",
  "on request": "bajo petición",
  "On request — never offered unprompted":
    "Bajo petición: nunca se ofrece sin pedirlo",
  "{n} findings": "{n} hallazgos",
  "{n} passes": "{n} pasadas",
  "no summary recorded for that pass.": "no se registró resumen de esa pasada.",
  "What it found": "Lo que encontró",
  "Earlier passes": "Pasadas anteriores",
  "Fix": "Solución",
  "Run": "Ejecutar",
  "Run again": "Ejecutar de nuevo",
  "can propose into the world bible": "puede proponer cambios en la biblia del mundo",
  "the agent is busy — wait for the current turn to finish":
    "el agente está ocupado: espera a que termine el turno actual",
  "there is no script to read yet": "todavía no hay guion que leer",

  // Stages — the ordering is the craft advice, so the notes travel with it
  "Outline": "Esquema",
  "There's a premise and beats, maybe no scenes yet. Shape first — everything below is cheaper once this is settled.":
    "Hay una premisa y unos latidos, quizá aún sin escenas. Primero la forma: todo lo de abajo sale más barato cuando esto está resuelto.",
  "Draft": "Borrador",
  "Scenes exist and can be read end to end. This is where cause, coherence and character get audited.":
    "Las escenas existen y pueden leerse de principio a fin. Aquí se auditan la causalidad, la coherencia y los personajes.",
  "Polish": "Pulido",
  "The shape is settled; the work is now line- and beat-level. Punching up before this point polishes lines that are about to be cut.":
    "La forma ya está fijada; el trabajo es de línea y de latido. Pulir antes de este punto es afinar líneas que están a punto de cortarse.",
  "Locked": "Bloqueado",
  "The script is what it's going to be. These passes price the shoot and check the lines survive being spoken.":
    "El guion ya es lo que va a ser. Estas pasadas presupuestan el rodaje y comprueban que las líneas sobreviven al ser habladas.",

  // Format check (the deterministic lint)
  "Format check": "Revisión de formato",
  "Instant and free — a mechanical read of the pinned draft (sluglines, orphan dialogue, drifting character names). It is not a specialist pass and nothing here is a story note.":
    "Instantánea y gratuita: una lectura mecánica del borrador fijado (encabezados de escena, diálogos huérfanos, nombres de personaje que derivan). No es una pasada de especialista y nada de esto es una nota de historia.",
  "{n} issues": "{n} problemas",
  "Clean": "Sin problemas",
  "high": "alta",
  "medium": "media",
  "low": "baja",
  "{n} scenes": "{n} escenas",
  "{n} dialogue lines": "{n} líneas de diálogo",
  "{n} words": "{n} palabras",
  "~{time} runtime": "~{time} de duración",
  "and {n} more — the Script tab is where they get fixed.":
    "y {n} más: se corrigen en la pestaña Guion.",
  "Who speaks": "Quién habla",

  // Relative time (shared shape with the Script tab's drafts list)
  "just now": "ahora mismo",
  "{m}m ago": "hace {m} min",
  "{h}h ago": "hace {h} h",
  "{d}d ago": "hace {d} d",

  // ── The specialist roster (src/lib/specialists.ts) ─────────────────
  // Chips, titles and one-line descriptions. The briefs stay in English: they
  // are prompts sent to the agent, not interface copy.
  "Structure": "Estructura",
  "Shape the arc": "Dar forma al arco",
  "maps the episode onto a narrative structure":
    "mapea el episodio sobre una estructura narrativa",
  "Scenes": "Escenas",
  "Make every scene turn": "Que cada escena gire",
  "checks each scene enters late, leaves early and turns":
    "comprueba que cada escena entra tarde, sale pronto y gira",
  "Whys": "Porqués",
  "Find the whys": "Encontrar los porqués",
  "checks every beat is caused by character, not convenience":
    "comprueba que cada latido lo causa el personaje, no la conveniencia",
  "Plot holes": "Agujeros de trama",
  "Hunt the plot holes": "Cazar los agujeros de trama",
  "audits continuity, setups and payoffs":
    "audita la continuidad, los planteamientos y sus pagos",
  "Character": "Personaje",
  "Make the cast legible": "Hacer legible al reparto",
  "checks each personality reads from behaviour alone":
    "comprueba que cada personalidad se lee solo por su comportamiento",
  "Theme": "Tema",
  "Say what it’s about": "Decir de qué va",
  "checks the theme is argued, not stated":
    "comprueba que el tema se argumenta, no se enuncia",
  "Tension": "Tensión",
  "Chart the tension": "Trazar la tensión",
  "graphs the pressure scene by scene and finds the sag":
    "grafica la presión escena a escena y encuentra el bajón",
  "Dialogue": "Diálogo",
  "Punch up the lines": "Afilar las líneas",
  "sharpens voice, subtext and rhythm": "afina la voz, el subtexto y el ritmo",
  // ("World" — the roster's world-continuity chip — is already translated at the
  // top of this file as the app-shell tab label, and the word is the same.)
  "Match the world bible": "Cuadrar con la biblia del mundo",
  "checks the script against the world you wrote":
    "contrasta el guion con el mundo que escribiste",
  "Producible": "Producible",
  "Price the shoot": "Presupuestar el rodaje",
  "checks the script can actually be rendered":
    "comprueba que el guion se puede renderizar de verdad",
  "Speakable": "Decible",
  "Make it speakable": "Hacerlo decible",
  "checks the lines survive being spoken by a voice model":
    "comprueba que las líneas sobreviven al ser habladas por un modelo de voz",
  "Voices": "Voces",
  "Design the voices": "Diseñar las voces",
  "writes each character’s speech DNA into the bible":
    "escribe el ADN del habla de cada personaje en la biblia",
  "Punch-up": "Chispa",
  "Make it sparkle": "Que brille",
  "swings for the memorable line, not the correct one":
    "va a por la línea memorable, no por la correcta",
  "Table read": "Lectura de mesa",
  "Hold a table read": "Hacer una lectura de mesa",
  "casts an actor per character and collects their notes":
    "asigna un actor por personaje y recoge sus notas",
  "Cold read": "Lectura en frío",
  "Get a cold read": "Conseguir una lectura en frío",
  "reads it blind and says where it lost them":
    "lo lee a ciegas y dice dónde le perdió",
};
