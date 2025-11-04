import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationHistory, userContext, miningStats, systemVersion } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      throw new Error('AI service not configured');
    }

    console.log('🤖 Deepseek Chat - Processing request');

    // Ultra-minimal system prompt
    const systemPrompt = `You are Eliza, an AI assistant for XMRT-DAO.`;

    // Only send last 3 messages, strip to minimal format
    const recentMessages = messages.slice(-3).map((msg: any) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
    
    const deepseekMessages = [
      { role: 'system', content: systemPrompt },
      ...recentMessages
    ];

    console.log('📤 Calling Lovable AI Gateway (DeepSeek model)...');
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: deepseekMessages,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Lovable AI rate limit exceeded. Please try again in a moment.' 
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Lovable AI credits exhausted. Please add credits at Settings → Workspace → Usage.' 
          }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Lovable AI Gateway error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    console.log('✅ Lovable AI Gateway response:', { 
      hasContent: !!message?.content,
      usage: data.usage
    });

    // Return the response
    const aiResponse = message?.content || "I'm here to help with XMRT-DAO tasks.";

    return new Response(
      JSON.stringify({ success: true, response: aiResponse, hasToolCalls: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Deepseek chat error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
