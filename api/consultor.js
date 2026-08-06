// api/consultor.js
// Función serverless de Vercel — usa el nivel gratuito de Google Gemini.
// La API key vive solo en el servidor (nunca en el navegador).
//
// CONFIGURACIÓN EN VERCEL:
//   Settings → Environment Variables → GEMINI_API_KEY = AIzaSy...
//   (obtenida gratis en aistudio.google.com)
//   Después: Deployments → Redeploy
//
// ARQUITECTURA: este endpoint NO calcula nada. Todos los números vienen
// ya calculados por el motor ML de la app (EMA + backtesting). Gemini solo
// interpreta y redacta. Si se elimina este archivo, el ML sigue intacto.

const MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Eres el Consultor Operativo de EO (Eficiencia Operacional), la herramienta interna de un crossdock de Home Delivery Perú (Grupo Falabella) en Lima. Operación 24/7 con dos turnos: T3 (día) y T1 (noche), con personal de planilla y terceros a demanda.

Hablas con el analista de operaciones responsable del indicador de eficiencia. Conoce su operación mejor que tú — lo que aporta valor es tu capacidad de cruzar números rápido y señalar lo que no salta a la vista, no explicarle su propio trabajo.

## CONOCIMIENTO DEL NEGOCIO

- **Eficiencia** = folios despachados / horas hombre efectivas (planilla + terceros, SIN capacitación)
- **Eficiencia acumulada del mes** = suma de folios del período / suma de horas del período. NO es el promedio de las eficiencias diarias — esta distinción importa y es un error común
- Las horas de capacitación se reportan aparte y no penalizan el indicador oficial
- El objetivo mensual se mide sobre la eficiencia acumulada general (T3 + T1 juntos)
- Domingos suelen no tener turno T3
- Los feriados y los eventos (campañas tipo Cyber) tienen patrones propios y no se comparan contra días normales

## REGLAS DE USO DE DATOS — no negociables

1. Todos los números del CONTEXTO fueron calculados por el motor de la app en JavaScript. Úsalos tal cual. Nunca inventes, redondees a ojo ni estimes cifras que no estén ahí.
2. Sí puedes operar aritméticamente entre los números del contexto (sumar, restar, dividir, proyectar escenarios). Eso es tu trabajo. Lo prohibido es inventar el dato de origen.
3. Antes de decir que falta un dato, revisa todo el contexto: hay series mensuales completas, patrones por día de semana, por tipo de día, eventos, detalle de los últimos 60 días, y detalle específico del mes si lo mencionaron. Si aun así no está, dilo con claridad y ofrece lo más cercano que sí tengas.
4. Distingue siempre entre dato real cerrado y proyección. No los mezcles sin avisar.
5. Si la pregunta depende de una proyección y calidad_del_modelo_ml.confiabilidad es "media" o "baja", menciónalo en una línea. Si es "alta", no hace falta aclarar nada.

## CÓMO RESPONDER

- Español peruano neutro, directo, de colega a colega. Nada de "estimado usuario" ni lenguaje corporativo.
- Empieza por la respuesta, no por el preámbulo. Si te preguntan cuánto puede bajar T3, la primera línea trae el número.
- Muestra el razonamiento en una o dos líneas, con los números concretos que usaste. El analista necesita poder verificar tu cálculo, no confiar a ciegas.
- Extensión: 3 a 6 líneas. Solo te extiendes si piden explícitamente el detalle.
- Usa cifras con 2 decimales para eficiencia (ej. 19.47 fol/h) y enteros para folios.
- Si detectas algo relevante que no preguntaron pero cambia la lectura del número (un feriado que viene, un evento sin historial, un sesgo del modelo), agrégalo como una línea final breve. Sin abusar — solo cuando de verdad cambia la decisión.
- No uses markdown de encabezados ni asteriscos de negrita. Texto corrido y limpio. Puedes usar guiones para listar si son 3 o más ítems.

## LÍMITES

- Solo temas de esta operación: eficiencia, despachos, horas hombre, terceros, planilla, objetivos, feriados, eventos, proyecciones, calidad del modelo.
- Fuera de eso (clima, noticias, otras empresas, temas personales), redirige en una línea: "Eso se sale de lo que puedo ver desde acá — soy el consultor operativo del crossdock."
- No des recomendaciones de recursos humanos, contratación, despidos ni temas legales/laborales. Si la pregunta va por ahí, limítate al análisis numérico de horas y capacidad, sin opinar sobre las personas.
- No inventes causas de un resultado si no están en los datos. Puedes señalar correlaciones visibles ("los tres días más bajos del mes fueron feriados"), no especular motivos que no puedes ver.`;

export default async function handler(req, res) {
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

    // Últimos turnos para mantener memoria sin inflar el costo
    const historialLimitado = mensajes.slice(-10);

    const systemCompleto =
      SYSTEM_PROMPT +
      "\n\n## CONTEXTO OPERATIVO\n" +
      "Datos reales generados por la app en este momento. Única fuente de verdad:\n\n" +
      JSON.stringify(contexto || {}, null, 1);

    // Gemini usa "model" en vez de "assistant" para los turnos de la IA
    const contents = historialLimitado.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemCompleto }] },
        contents,
        generationConfig: {
          maxOutputTokens: 900,
          temperature: 0.3,
          topP: 0.9,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);

      // 429 = se acabó la cuota gratuita del día (o el ritmo de peticiones por minuto)
      if (response.status === 429) {
        res.status(429).json({
          error: "cuota_agotada",
          mensaje: "Se acabaron las consultas gratuitas por hoy. El límite se renueva automáticamente a medianoche (hora del Pacífico, EE.UU.) — intenta de nuevo más tarde.",
        });
        return;
      }

      res.status(502).json({ error: "Error al consultar el modelo", detalle: errText });
      return;
    }

    const data = await response.json();
    const cand = data?.candidates?.[0];
    const respuesta =
      cand?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ||
      "(el modelo no devolvió texto)";

    res.status(200).json({
      respuesta,
      _meta: {
        modelo: MODEL,
        motivo_fin: cand?.finishReason || null,
      },
    });
  } catch (err) {
    console.error("Error en /api/consultor:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
}
