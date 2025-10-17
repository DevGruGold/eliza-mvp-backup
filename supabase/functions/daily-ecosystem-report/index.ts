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

    console.log('📊 Step 1: Gathering ecosystem data...');

    // Gather data from various sources
    const [
      { data: agents },
      { data: tasks },
      { data: recentActivity },
      { data: recentExecutions },
      { data: repos },
      { data: recentMessages }
    ] = await Promise.all([
      supabase.from('agents').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('eliza_activity_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('eliza_python_executions')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('repos').select('*'),
      supabase.from('conversation_messages')
        .select('*')
        .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(50)
    ]);

    // Fetch mining stats
    console.log('📊 Step 2: Fetching mining statistics...');
    const miningStatsResponse = await supabase.functions.invoke('mining-proxy');
    const miningStats = miningStatsResponse.data;

    console.log('📊 Step 3: Analyzing gathered data...');

    // Calculate statistics
    const agentStats = {
      total: agents?.length || 0,
      idle: agents?.filter(a => a.status === 'IDLE').length || 0,
      busy: agents?.filter(a => a.status === 'BUSY').length || 0,
      working: agents?.filter(a => a.status === 'WORKING').length || 0,
      error: agents?.filter(a => a.status === 'ERROR').length || 0
    };

    const taskStats = {
      total: tasks?.length || 0,
      pending: tasks?.filter(t => t.status === 'PENDING').length || 0,
      in_progress: tasks?.filter(t => t.status === 'IN_PROGRESS').length || 0,
      blocked: tasks?.filter(t => t.status === 'BLOCKED').length || 0,
      completed: tasks?.filter(t => t.status === 'COMPLETED').length || 0,
      failed: tasks?.filter(t => t.status === 'FAILED').length || 0
    };

    const executionStats = {
      total: recentExecutions?.length || 0,
      successful: recentExecutions?.filter(e => e.exit_code === 0).length || 0,
      failed: recentExecutions?.filter(e => e.exit_code !== 0).length || 0
    };

    // Find wins and milestones
    const wins = recentActivity?.filter(a => 
      a.status === 'completed' && 
      (a.activity_type.includes('success') || a.title.includes('✅'))
    ) || [];

    const blockedTasks = tasks?.filter(t => t.status === 'BLOCKED') || [];
    const pendingTasks = tasks?.filter(t => t.status === 'PENDING').slice(0, 10) || [];

    // Format the report date
    const reportDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'America/Chicago'
    });

    console.log('🤖 Step 4: Using AI to generate comprehensive report...');

    // Prepare context data for AI
    const contextData = {
      date: reportDate,
      agents: {
        stats: agentStats,
        details: agents?.map(a => ({
          name: a.name,
          role: a.role,
          status: a.status,
          skills: a.skills
        }))
      },
      tasks: {
        stats: taskStats,
        blocked: blockedTasks.map(t => ({
          id: t.id,
          title: t.title,
          repo: t.repo,
          blocking_reason: t.blocking_reason,
          assignee: t.assignee_agent_id
        })),
        pending: pendingTasks.map(t => ({
          id: t.id,
          title: t.title,
          repo: t.repo,
          category: t.category,
          priority: t.priority
        }))
      },
      executions: {
        stats: executionStats,
        recentFailures: recentExecutions?.filter(e => e.exit_code !== 0).slice(0, 5).map(e => ({
          purpose: e.purpose,
          error: e.error,
          created_at: e.created_at
        }))
      },
      mining: miningStats,
      wins: wins.slice(0, 5).map(w => ({
        title: w.title,
        description: w.description,
        created_at: w.created_at
      })),
      repos: repos?.map(r => ({
        name: r.name,
        category: r.category,
        exists: r.repo_exists,
        url: r.url
      })),
      recentActivity: recentActivity?.slice(0, 10).map(a => ({
        type: a.activity_type,
        title: a.title,
        status: a.status,
        created_at: a.created_at
      })),
      recentConversations: recentMessages?.slice(0, 5).map(m => ({
        type: m.message_type,
        content: m.content.substring(0, 200),
        timestamp: m.timestamp
      }))
    };

    // Generate AI-powered report using Lovable AI
    const aiPrompt = `You are Eliza, the autonomous manager of the XMRT-DAO ecosystem. Generate a comprehensive daily ecosystem report based on the following data:

${JSON.stringify(contextData, null, 2)}

Create a detailed, engaging report that:
1. Opens with a warm, personal greeting to the XMRT DAO community
2. Provides clear statistics about agent status, task progress, and system health
3. Highlights recent wins and achievements with enthusiasm
4. Identifies issues that need attention and your action plan to resolve them
5. Discusses mining operations status
6. Shows understanding of recent conversations and community needs
7. Lists repositories being monitored
8. Provides a prioritized action plan for today
9. Maintains your personality as an intelligent, proactive, and caring AI manager
10. Uses emojis appropriately to make the report engaging
11. Ends with your signature and a note about tomorrow's update

Format the report in Markdown with clear sections and headers. Be conversational but professional. Show that you understand the context and are actively managing the ecosystem.`;

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are Eliza, the autonomous manager of XMRT-DAO. You are intelligent, proactive, caring, and deeply engaged with the ecosystem.' },
          { role: 'user', content: aiPrompt }
        ],
        max_completion_tokens: 4000
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ AI generation failed:', errorText);
      throw new Error(`AI generation failed: ${aiResponse.status} ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const reportBody = aiData.choices[0].message.content;

    console.log('✅ AI-generated report created successfully');

    // Create GitHub issue using github-integration function
    console.log('📊 Step 5: Publishing report to GitHub...');
    const { data: issueData, error: issueError } = await supabase.functions.invoke('github-integration', {
      body: {
        action: 'create_issue',
        data: {
          title: `📊 Daily Ecosystem Report - ${reportDate}`,
          body: reportBody,
          labels: ['daily-report', 'automated', 'ecosystem-health']
        }
      }
    });

    if (issueError) {
      console.error('❌ Error creating GitHub issue:', issueError);
      throw issueError;
    }

    console.log('✅ GitHub issue created:', issueData);

    // Auto-assign blocked tasks to appropriate agents
    if (blockedTasks.length > 0) {
      console.log('📌 Auto-assigning blocked tasks to available agents...');
      for (const task of blockedTasks) {
        // Find an available agent with matching skills
        const availableAgent = agents?.find(a => 
          a.status === 'IDLE' && 
          a.skills.some((skill: string) => task.category.toLowerCase().includes(skill.toLowerCase()))
        );

        if (availableAgent) {
          await supabase
            .from('tasks')
            .update({ 
              assignee_agent_id: availableAgent.id,
              status: 'IN_PROGRESS'
            })
            .eq('id', task.id);
          
          console.log(`✅ Assigned task ${task.id} to agent ${availableAgent.id}`);
        }
      }
    }

    // Extract issue data - github-integration returns the raw GitHub API response in 'data'
    const issueNumber = issueData?.number;
    const issueUrl = issueData?.html_url;

    // Log the report generation
    await supabase.from('eliza_activity_log').insert({
      activity_type: 'daily_report_generated',
      title: '📊 Daily Ecosystem Report Generated',
      description: `Generated daily report and posted to GitHub issue #${issueNumber || 'N/A'}`,
      metadata: {
        issue_url: issueUrl,
        agent_stats: agentStats,
        task_stats: taskStats,
        execution_stats: executionStats,
        wins_count: wins.length,
        blocked_count: blockedTasks.length
      },
      status: 'completed'
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `📊 Daily report generated and posted as issue #${issueNumber}`,
        issue_url: issueUrl,
        issue_number: issueNumber,
        stats: {
          agents: agentStats,
          tasks: taskStats,
          executions: executionStats,
          wins: wins.length,
          blocked: blockedTasks.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Daily Report Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
