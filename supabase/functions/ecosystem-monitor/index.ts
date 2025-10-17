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

    console.log('🔍 Ecosystem Monitor - Running health checks...');

    // Check agent health
    const { data: agents } = await supabase
      .from('agents')
      .select('*');

    const agentHealth = {
      total: agents?.length || 0,
      idle: agents?.filter(a => a.status === 'IDLE').length || 0,
      busy: agents?.filter(a => a.status === 'BUSY').length || 0,
      working: agents?.filter(a => a.status === 'WORKING').length || 0,
      error: agents?.filter(a => a.status === 'ERROR').length || 0
    };

    // Check task health
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*');

    const taskHealth = {
      total: tasks?.length || 0,
      pending: tasks?.filter(t => t.status === 'PENDING').length || 0,
      in_progress: tasks?.filter(t => t.status === 'IN_PROGRESS').length || 0,
      blocked: tasks?.filter(t => t.status === 'BLOCKED').length || 0,
      completed: tasks?.filter(t => t.status === 'COMPLETED').length || 0,
      failed: tasks?.filter(t => t.status === 'FAILED').length || 0
    };

    // Check Python execution health
    const { data: recentExecutions } = await supabase
      .from('eliza_python_executions')
      .select('*')
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
      .order('created_at', { ascending: false })
      .limit(100);

    const executionHealth = {
      total_last_hour: recentExecutions?.length || 0,
      successful: recentExecutions?.filter(e => e.exit_code === 0).length || 0,
      failed: recentExecutions?.filter(e => e.exit_code !== 0).length || 0,
      success_rate: (recentExecutions?.filter(e => e.exit_code === 0).length || 0) / (recentExecutions?.length || 1)
    };

    // Check recent activity
    const { data: recentActivity } = await supabase
      .from('eliza_activity_log')
      .select('*')
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    const activityByType: Record<string, number> = {};
    for (const activity of recentActivity || []) {
      activityByType[activity.activity_type] = (activityByType[activity.activity_type] || 0) + 1;
    }

    // Determine overall health status
    let overallStatus = 'healthy';
    const issues = [];

    if (taskHealth.blocked > 0) {
      issues.push(`${taskHealth.blocked} blocked tasks`);
      overallStatus = 'warning';
    }

    if (agentHealth.error > 0) {
      issues.push(`${agentHealth.error} agents in error state`);
      overallStatus = 'warning';
    }

    if (executionHealth.success_rate < 0.7) {
      issues.push(`Low execution success rate: ${(executionHealth.success_rate * 100).toFixed(1)}%`);
      overallStatus = 'warning';
    }

    if (agentHealth.idle === agentHealth.total && taskHealth.pending > 0) {
      issues.push(`All agents idle with ${taskHealth.pending} pending tasks`);
      overallStatus = 'warning';
    }

    // Log the health check
    await supabase.from('eliza_activity_log').insert({
      activity_type: 'ecosystem_health_check',
      title: `🏥 Ecosystem Health: ${overallStatus.toUpperCase()}`,
      description: issues.length > 0 ? issues.join(', ') : 'All systems operational',
      metadata: {
        agent_health: agentHealth,
        task_health: taskHealth,
        execution_health: executionHealth,
        activity_breakdown: activityByType,
        overall_status: overallStatus
      },
      status: overallStatus === 'healthy' ? 'completed' : 'warning'
    });

    return new Response(
      JSON.stringify({
        success: true,
        overall_status: overallStatus,
        issues,
        health: {
          agents: agentHealth,
          tasks: taskHealth,
          executions: executionHealth,
          recent_activity: activityByType
        },
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Ecosystem Monitor Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
