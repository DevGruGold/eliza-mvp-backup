import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, messages } = await req.json();
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      console.error('Lovable API key not configured');
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`📝 Summarizing conversation for session ${session_id}...`);

    // Prepare conversation text
    const conversationText = messages.map((msg: any) => 
      `${msg.message_type}: ${msg.content}`
    ).join('\n');

    // Generate summary using Lovable AI Gateway
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'Create a concise summary of this conversation. Focus on key topics, decisions, and action items. Keep it under 200 words.'
          },
          { role: 'user', content: conversationText }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting
      if (response.status === 429) {
        console.error('⏸️ Lovable AI rate limit exceeded');
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, please try again later' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Handle payment required
      if (response.status === 402) {
        console.error('💳 Lovable AI payment required');
        return new Response(JSON.stringify({ error: 'Payment required, please add credits to your workspace' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.error('AI Gateway error:', errorText);
      throw new Error(`AI Gateway error: ${errorText}`);
    }

    const data = await response.json();
    const summary = data.choices[0]?.message?.content;

    // Store summary in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: summaryData, error: insertError } = await supabase
      .from('conversation_summaries')
      .insert({
        session_id,
        summary_text: summary,
        message_count: messages.length,
        start_message_id: messages[0]?.id,
        end_message_id: messages[messages.length - 1]?.id,
        metadata: { generated_at: new Date().toISOString() }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw insertError;
    }

    console.log(`✅ Created summary for session ${session_id}`);

    return new Response(
      JSON.stringify({ success: true, summary_id: summaryData.id, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in summarize-conversation function:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
