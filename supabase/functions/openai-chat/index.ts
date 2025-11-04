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
    const { messages, model = "openai/gpt-5-mini", temperature = 0.9, max_tokens = 8000 } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      throw new Error('Messages array is required');
    }

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('🤖 Lovable AI Chat - Processing request:', {
      messageCount: messages.length,
      model,
      temperature,
      max_tokens
    });

    // Call Lovable AI Gateway
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false
      }),
    });

    if (!response.ok) {
      // Handle rate limiting
      if (response.status === 429) {
        console.error('⏸️ Lovable AI rate limit exceeded');
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Rate limit exceeded, please try again later' 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Handle payment required
      if (response.status === 402) {
        console.error('💳 Lovable AI payment required');
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Payment required, please add credits to your workspace' 
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const errorData = await response.json();
      console.error('❌ Lovable AI Gateway error:', errorData);
      throw new Error(errorData.error?.message || 'AI Gateway request failed');
    }

    const data = await response.json();
    console.log('✅ OpenAI Chat - Response received:', {
      choices: data.choices?.length || 0,
      usage: data.usage
    });

    return new Response(JSON.stringify({
      success: true,
      response: data.choices[0]?.message?.content || '',
      usage: data.usage,
      model: data.model
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ OpenAI Chat function error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Unknown error occurred'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});