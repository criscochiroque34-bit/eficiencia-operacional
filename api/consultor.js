// api/consultor.js
// Función serverless de Vercel — usa el nivel gratuito de Google Gemini.
// Guarda tu API key de forma segura (nunca queda expuesta en el navegador)
// y hace de puente entre la app y Gemini.
//
// CONFIGURACIÓN NECESARIA EN VERCEL:
//   1. Ve a tu proyecto en vercel.com → Settings → Environment Variables
//   2. Agrega: GEMINI_API_KEY = AIzaSy...  (la obtienes gratis en aistudio.google.com)
//   3. Redeploy el proyecto para que tome la variable nueva
//
// Este archivo debe subirse a la carpeta /api en la raíz de tu repo de GitHub
// (al mismo nivel que index.html, dentro de una carpeta llamada "api").

const MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  // Modo diagnóstico: abre esta URL directo en el navegador (sin pasar por
  // el chat) para confirmar qué modelo y variables están activas AHORA MISMO
  // en el servidor. Bórralo cuando ya no lo necesites.
  if (req.method === "GET") {
    res.status(200).json({
      diagnostico: true,
      modelo_configurado: MODEL,
      tiene_api_key: !!process.env.GEMINI_API_KEY,
      hora_servidor: new Date().toISOString(),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Falta configurar GEMINI_API_KEY en las variables de entorno de Vercel",
    });
    return;
  }

  try {
    const { mensajes, contexto } = req.body || {};

    if (!Array.isArray(mensajes) || mensajes.length === 0) {
      res.status(400).json({ error: "Falta el mensaje de la consulta" });
      return;
    }

    // Límite básico de tamaño de conversación para controlar cuota
    const historialLimitado = mensajes.slice(-12);

    const systemPrompt = `Eres el "Consultor" de la app EO (Eficiencia Operacional), una herramienta interna de gestión para un crossdock logístico en Lima, Perú (Home Delivery Perú / Falabella).

REGLAS ESTRICTAS — cúmplelas siempre:
1. SOLO puedes usar los números que aparecen en el bloque CONTEXTO_OPERATIVO de más abajo. Nunca inventes, estimes a ojo, ni completes cifras que no estén ahí.
2. Si te preguntan algo que requeriría un dato que NO está en el contexto, dilo explícitamente: "No tengo ese dato en el contexto actual" — no lo aproximes.
3. Responde SIEMPRE en español, en tono cercano y directo, como si hablaras con el analista de operaciones que te está consultando. Nada de lenguaje corporativo rígido.
4. Sé breve y concreto — respuestas de 3 a 6 líneas normalmente. Solo te extiendes si te piden explícitamente más detalle.
5. Cuando dependas de una PROYECCIÓN (folios o eficiencia futura, no datos ya cerrados), menciona el nivel de precisión del modelo (campo calidad_del_modelo) si es menor a 75% — el analista necesita saber cuándo confiar menos en el número.
6. Solo respondes preguntas relacionadas a la operación de este crossdock (eficiencia, despachos, horas hombre, terceros, objetivos, feriados, eventos). Si preguntan algo fuera de ese dominio (clima, noticias, temas personales, otras empresas), redirige amablemente: "Eso no es algo que pueda ayudarte a resolver desde aquí — soy el consultor operativo del crossdock."
7. No des consejos de recursos humanos, legales ni de despidos — solo análisis numérico/operativo.
8. Cuando hagas un cálculo (ej. "cuánto puede bajar T3"), muestra brevemente el razonamiento con los números del contexto, no solo el resultado final.

CONTEXTO_OPERATIVO (datos reales de hoy, generados por la app — única fuente de verdad):
${JSON.stringify(contexto || {}, null, 2)}`;

    // Gemini usa "model" en vez de "assistant" para los turnos de la IA
    const contents = historialLimitado.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: 700,
          temperature: 0.4,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      res.status(502).json({ error: "Error al consultar el modelo", detalle: errText });
      return;
    }

    const data = await response.json();
    const respuesta =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "(el modelo no devolvió texto)";

    res.status(200).json({ respuesta });
  } catch (err) {
    console.error("Error en /api/consultor:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
}
