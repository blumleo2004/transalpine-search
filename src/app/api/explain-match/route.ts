import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { q, content } = body;

    if (!q || !content) {
      return NextResponse.json(
        { error: 'Parameters q and content are required' },
        { status: 400 }
      );
    }

    const hasOpenAI = !!process.env.OPENAI_API_KEY;

    if (hasOpenAI) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const prompt = `Du bist ein hilfreicher Assistent für eine transalpine Podcast-Suchmaschine.
Nutzer sucht nach: "${q}"
Gefundener Textabschnitt: "${content}"

Erkläre in 1-2 kurzen, klaren Sätzen auf Deutsch, warum dieser Abschnitt für die Suchanfrage relevant ist. Nenne auch die konkreten Wörter oder Phrasen (1 bis maximal 3 Begriffe) aus dem Textabschnitt, die semantisch am stärksten mit der Suchanfrage zusammenhängen.

Antworte ausschließlich im folgenden JSON-Format:
{
  "explanation": "Erklärung auf Deutsch...",
  "keywords": ["Phrase 1", "Phrase 2"]
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 150,
      });

      const responseText = response.choices[0]?.message?.content;
      if (responseText) {
        const parsed = JSON.parse(responseText);
        return NextResponse.json({
          explanation: parsed.explanation || 'Relevanter Sinn-Treffer.',
          keywords: parsed.keywords || []
        });
      }
    }

    // Fallback if no OpenAI API Key or call fails
    const queryWords = q
      .toLowerCase()
      .split(/\s+/)
      .filter((w: string) => w.length > 2);
      
    const foundKeywords: string[] = [];
    for (const word of queryWords) {
      if (content.toLowerCase().includes(word)) {
        // Find exact casing from original text
        const index = content.toLowerCase().indexOf(word);
        if (index !== -1) {
          foundKeywords.push(content.substring(index, index + word.length));
        }
      }
    }

    let explanation = 'Dieser Abschnitt wurde über die semantische KI-Sinnsuche als thematisch relevant eingestuft.';
    if (foundKeywords.length > 0) {
      explanation = `Der Abschnitt enthält direkte Übereinstimmungen mit den Suchbegriffen: "${foundKeywords.join(', ')}".`;
    }

    return NextResponse.json({
      explanation,
      keywords: foundKeywords.slice(0, 3)
    });

  } catch (err: any) {
    console.error('Explain Match error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
