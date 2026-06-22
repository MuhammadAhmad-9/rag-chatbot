import { NextResponse } from 'next/server';
import { runAgent } from '@/agents/run';

export async function POST(req: Request) {
  try {
    const { messages, message } = await req.json();
    console.log('working')

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const result = await runAgent(messages || [], message.trim());
    
    return result.toTextStreamResponse();
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}