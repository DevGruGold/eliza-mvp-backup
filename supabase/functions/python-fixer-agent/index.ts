import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { execution_id } = await req.json();

    console.log('🔧 Python Fixer Agent - Starting fix for execution:', execution_id);

    // Get the failed execution
    const { data: execution, error: fetchError } = await supabase
      .from('eliza_python_executions')
      .select('*')
      .eq('id', execution_id)
      .single();

    if (fetchError || !execution) {
      throw new Error(`Failed to fetch execution: ${fetchError?.message}`);
    }

    console.log('📋 Original code:', execution.code);
    console.log('❌ Error:', execution.error);

    // Use OpenAI to analyze and fix the code
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const fixPrompt = `PYTHON CODE FIXER - STANDARD LIBRARY ONLY

⚠️ SANDBOX ENVIRONMENT CONSTRAINTS:
• Python 3.10 with STANDARD LIBRARY ONLY
• NO pip packages (requests, numpy, pandas will FAIL with ModuleNotFoundError)
• MUST use: urllib.request, urllib.parse, json, http.client, re, os, sys, etc.

FAILED CODE:
\`\`\`python
${execution.code}
\`\`\`

ERROR MESSAGE:
${execution.error}

PURPOSE: ${execution.purpose || 'Unknown'}

REQUIRED CONVERSIONS:
1. requests.get(url) → urllib.request.urlopen(url)
2. requests.post(url, json=data) → urllib.request.Request(url, data=json.dumps(data).encode(), method='POST')
3. response.json() → json.loads(response.read().decode())

INSTRUCTIONS:
• Return ONLY the fixed Python code
• NO markdown formatting (no \`\`\`python blocks)
• NO explanations or comments
• Use ONLY standard library modules
• If you see "import requests" - IMMEDIATELY replace with urllib equivalent

CORRECT urllib.request example:
import urllib.request
import json
req = urllib.request.Request('https://api.example.com', headers={'Authorization': 'Bearer token'})
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    print(data)
`;

    console.log('🤖 Calling OpenAI for code fix...');

    const aiResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a Python debugging expert. Always return only the fixed Python code without any explanations or markdown formatting.'
            },
            {
              role: 'user',
              content: fixPrompt
            }
          ],
        })
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI Gateway error:', errorText);
      
      // Check if it's a rate limit or payment error
      if (aiResponse.status === 429) {
        console.log('⏸️ Lovable AI rate limit exceeded, skipping fix attempt');
        
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'python_fix',
          title: '⏸️ Python Fix Skipped - Rate Limited',
          description: 'Lovable AI rate limit exceeded. Code fix skipped.',
          status: 'pending',
          metadata: {
            execution_id,
            reason: 'rate_limit_exceeded',
            error: execution.error?.substring(0, 100)
          }
        });
        
        return new Response(JSON.stringify({
          success: false,
          skipped: true,
          reason: 'rate_limit_exceeded',
          error: 'Lovable AI rate limit exceeded'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }
      
      if (aiResponse.status === 402) {
        console.log('⏸️ Lovable AI payment required, skipping fix attempt');
        
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'python_fix',
          title: '💳 Python Fix Skipped - Payment Required',
          description: 'Lovable AI credits exhausted. Code fix skipped.',
          status: 'pending',
          metadata: {
            execution_id,
            reason: 'payment_required',
            error: execution.error?.substring(0, 100)
          }
        });
        
        return new Response(JSON.stringify({
          success: false,
          skipped: true,
          reason: 'payment_required',
          error: 'Lovable AI payment required'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }
      
      throw new Error(`Lovable AI Gateway failed: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    let fixedCode = aiData.choices?.[0]?.message?.content || '';

    console.log('✅ Received fix from Lovable AI Gateway');

    // Clean up the code (remove markdown if present)
    fixedCode = fixedCode.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('🔄 Fixed code:', fixedCode);

    // Execute the fixed code
    const { data: execResult, error: execError } = await supabase.functions.invoke('python-executor', {
      body: {
        code: fixedCode,
        stdin: '',
        args: []
      }
    });

    if (execError) {
      console.error('❌ Fixed code execution failed:', execError);
      
      // Log the failed attempt
      await supabase.from('eliza_python_executions').insert({
        code: fixedCode,
        output: '',
        error: execError.message,
        exit_code: 1,
        source: 'python-fixer-agent',
        purpose: `Fix attempt for: ${execution.purpose || 'Unknown'}`
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'Fixed code still failed',
        attempted_fix: fixedCode,
        new_error: execError.message
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    console.log('✅ Fixed code executed successfully!');

    // Log the successful execution
    const { data: successExec } = await supabase.from('eliza_python_executions').insert({
      code: fixedCode,
      output: execResult.output,
      error: execResult.error || '',
      exit_code: execResult.exitCode || 0,
      source: 'python-fixer-agent',
      purpose: `Fixed: ${execution.purpose || 'Unknown'}`
    }).select().single();

    // Create an activity log entry for Eliza with detailed learning data
    await supabase.from('eliza_activity_log').insert({
      activity_type: 'python_fix',
      title: '🔧 Python Code Auto-Fixed',
      description: `Successfully fixed and executed Python code. Original error: ${execution.error?.substring(0, 100)}...`,
      status: 'completed',
      metadata: {
        original_execution_id: execution_id,
        fixed_execution_id: successExec?.id,
        original_code: execution.code,
        fixed_code: fixedCode,
        original_error: execution.error,
        fix_output: execResult.output,
        purpose: execution.purpose,
        learning_insight: `Code fix pattern: ${execution.error?.split('\n')[0]} was resolved by modifying the code structure`,
        timestamp: new Date().toISOString()
      }
    });

    // Also create a human-readable conversation message for Eliza with the actual output
    const { data: sessions } = await supabase
      .from('conversation_sessions')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);

    if (sessions && sessions.length > 0) {
      // Create an assistant message with the actual output that Eliza was trying to get
      const outputMessage = execResult.output?.trim()
        ? `Here are the results from the fixed Python code:\n\n\`\`\`python\n${fixedCode}\n\`\`\`\n\n**Output:**\n${execResult.output}` 
        : `The Python code executed successfully:\n\n\`\`\`python\n${fixedCode}\n\`\`\`\n\n(No output generated)`;
      
      await supabase.from('conversation_messages').insert({
        session_id: sessions[0].id,
        message_type: 'assistant',
        content: outputMessage,
        metadata: {
          source: 'python-fixer-agent',
          fix_execution_id: successExec?.id,
          original_execution_id: execution_id,
          original_purpose: execution.purpose,
          auto_fixed: true
        }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      fixed_code: fixedCode,
      output: execResult.output,
      execution_id: successExec?.id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ Python Fixer Agent error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
