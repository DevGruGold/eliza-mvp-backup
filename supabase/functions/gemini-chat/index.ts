import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationHistory, userContext, miningStats, systemVersion } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service not configured");
    }

    console.log("🤖 Gemini Chat - Processing request");

    // Build concise system prompt (keep under 1000 chars)
    let systemPrompt = `You are Eliza, AI assistant for XMRT-DAO. Be conversational and helpful.`;
    
    // Add only essential context
    if (conversationHistory?.summaries?.length > 0) {
      const latest = conversationHistory.summaries[conversationHistory.summaries.length - 1];
      systemPrompt += `\n📚 Context: ${latest.summaryText.substring(0, 150)}`;
    }
    
    if (miningStats?.isOnline) {
      systemPrompt += `\n⛏️ Mining: ${miningStats.hashRate} H/s, ${miningStats.validShares} shares`;
    }
    
    if (userContext?.isFounder) {
      systemPrompt += `\n👤 User: Founder`;
    }

    // Prepare messages - only send last 10 messages to keep payload small
    const recentMessages = messages.slice(-10);
    const geminiMessages = [
      { role: "system", content: systemPrompt },
      ...recentMessages
    ];

    console.log("📤 Calling Lovable AI Gateway (Gemini)...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: geminiMessages,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Lovable AI rate limit exceeded. Please try again in a moment." 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Lovable AI credits exhausted. Please add credits at Settings → Workspace → Usage." 
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`Lovable AI Gateway error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    console.log("✅ Lovable AI Gateway response:", { 
      hasContent: !!message?.content,
      usage: data.usage
    });

    // Return the response
    const aiResponse = message?.content || "I'm here to help with XMRT-DAO tasks.";

    return new Response(
      JSON.stringify({ success: true, response: aiResponse, hasToolCalls: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Gemini chat error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: {
          type: 'invalid_request',
          code: 400,
          message: error instanceof Error ? error.message : 'Unknown error',
          service: 'gemini-chat',
          details: {
            timestamp: new Date().toISOString(),
            executive: 'CIO',
            model: 'google/gemini-2.5-pro'
          },
          canRetry: false,
          suggestedAction: 'check_request_format'
        }
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
