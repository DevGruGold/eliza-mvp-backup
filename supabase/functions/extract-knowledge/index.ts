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
    const { message_id, content, session_id } = await req.json();
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      console.error('Lovable API key not configured');
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🔍 Extracting knowledge from message ${message_id}...`);

    // Use Lovable AI Gateway to extract entities
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
            content: 'Extract key entities from the conversation. Return entities in JSON format with fields: entity_name, entity_type, description, confidence_score (0-1).'
          },
          { role: 'user', content }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_entities",
            description: "Extract knowledge entities from text",
            parameters: {
              type: "object",
              properties: {
                entities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      entity_name: { type: "string" },
                      entity_type: { type: "string" },
                      description: { type: "string" },
                      confidence_score: { type: "number" }
                    },
                    required: ["entity_name", "entity_type"],
                    additionalProperties: false
                  }
                }
              },
              required: ["entities"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "extract_entities" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting
      if (response.status === 429) {
        console.error('⏸️ Lovable AI rate limit exceeded');
        return new Response(JSON.stringify({ error: 'Rate limit exceeded', success: false }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Handle payment required
      if (response.status === 402) {
        console.error('💳 Lovable AI payment required');
        return new Response(JSON.stringify({ error: 'Payment required', success: false }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.error('AI Gateway error:', errorText);
      throw new Error(`AI Gateway error: ${errorText}`);
    }

    const data = await response.json();
    const toolCall = data.choices[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.log('No entities extracted');
      return new Response(JSON.stringify({ success: true, entities: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const entities = JSON.parse(toolCall.function.arguments).entities;

    // Store entities in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    for (const entity of entities) {
      await supabase.from('knowledge_entities').insert({
        entity_name: entity.entity_name,
        entity_type: entity.entity_type,
        description: entity.description || null,
        confidence_score: entity.confidence_score || 0.5,
        metadata: { source_message_id: message_id, session_id }
      });
    }

    console.log(`✅ Extracted ${entities.length} entities from message ${message_id}`);

    return new Response(
      JSON.stringify({ success: true, entities }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in extract-knowledge function:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
