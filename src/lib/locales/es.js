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
};
