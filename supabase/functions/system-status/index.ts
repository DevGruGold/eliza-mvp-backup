import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔍 System Status Check - Starting comprehensive diagnostics...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const RENDER_API_KEY = Deno.env.get("RENDER_API_KEY");
    const RENDER_API_BASE = "https://api.render.com/v1";
    const FLASK_SERVICE_URL = "https://xmrt-ecosystem-iofw.onrender.com";
    
    const statusReport: any = {
      timestamp: new Date().toISOString(),
      overall_status: 'healthy',
      components: {}
    };
    
    // 1. Check Database Health
    console.log('📊 Checking database health...');
    try {
      const { data: dbTest, error: dbError } = await supabase
        .from('agents')
        .select('id')
        .limit(1);
      
      statusReport.components.database = {
        status: dbError ? 'unhealthy' : 'healthy',
        error: dbError?.message,
        response_time_ms: 0 // Could add timing if needed
      };
    } catch (error) {
      statusReport.components.database = {
        status: 'error',
        error: (error as Error).message
      };
      statusReport.overall_status = 'degraded';
    }
    
    // 2. Check Agents Status
    console.log('🤖 Checking agents status...');
    try {
      const { data: agents, error: agentsError } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (agentsError) throw agentsError;
      
      const agentStats = {
        total: agents?.length || 0,
        idle: agents?.filter((a: any) => a.status === 'IDLE').length || 0,
        busy: agents?.filter((a: any) => a.status === 'BUSY').length || 0,
        working: agents?.filter((a: any) => a.status === 'WORKING').length || 0,
        completed: agents?.filter((a: any) => a.status === 'COMPLETED').length || 0,
        error: agents?.filter((a: any) => a.status === 'ERROR').length || 0
      };
      
      statusReport.components.agents = {
        status: 'healthy',
        stats: agentStats,
        recent_agents: agents?.slice(0, 5).map((a: any) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status
        }))
      };
      
      // Flag if too many errors
      if (agentStats.error > 3) {
        statusReport.components.agents.status = 'degraded';
        statusReport.overall_status = 'degraded';
      }
    } catch (error) {
      statusReport.components.agents = {
        status: 'error',
        error: (error as Error).message
      };
      statusReport.overall_status = 'degraded';
    }
    
    // 3. Check Tasks Status
    console.log('📋 Checking tasks status...');
    try {
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .order('updated_at', { ascending: false });
      
      if (tasksError) throw tasksError;
      
      const taskStats = {
        total: tasks?.length || 0,
        pending: tasks?.filter((t: any) => t.status === 'PENDING').length || 0,
        in_progress: tasks?.filter((t: any) => t.status === 'IN_PROGRESS').length || 0,
        blocked: tasks?.filter((t: any) => t.status === 'BLOCKED').length || 0,
        completed: tasks?.filter((t: any) => t.status === 'COMPLETED').length || 0,
        failed: tasks?.filter((t: any) => t.status === 'FAILED').length || 0
      };
      
      statusReport.components.tasks = {
        status: 'healthy',
        stats: taskStats,
        recent_tasks: tasks?.slice(0, 5).map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          stage: t.stage,
          priority: t.priority
        }))
      };
      
      // Flag if too many blocked or failed
      if (taskStats.blocked > 5 || taskStats.failed > 5) {
        statusReport.components.tasks.status = 'degraded';
        statusReport.overall_status = 'degraded';
      }
    } catch (error) {
      statusReport.components.tasks = {
        status: 'error',
        error: (error as Error).message
      };
      statusReport.overall_status = 'degraded';
    }
    
    // 4. Check Mining Proxy
    console.log('⛏️ Checking mining stats...');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const { data: miningData, error: miningError } = await supabase.functions.invoke('mining-proxy', {
        body: {}
      });
      
      clearTimeout(timeoutId);
      
      if (miningError) throw miningError;
      
      statusReport.components.mining = {
        status: 'healthy',
        hash_rate: miningData.hash || 0,
        total_hashes: miningData.totalHashes || 0,
        valid_shares: miningData.validShares || 0,
        amount_due: miningData.amtDue || 0
      };
    } catch (error) {
      statusReport.components.mining = {
        status: 'error',
        error: (error as Error).message
      };
    }
    
    // 5. Check Render Service Status
    console.log('🚀 Checking Render service status...');
    if (RENDER_API_KEY) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const servicesResponse = await fetch(`${RENDER_API_BASE}/services`, {
          headers: {
            "Authorization": `Bearer ${RENDER_API_KEY}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!servicesResponse.ok) {
          throw new Error(`Render API error: ${servicesResponse.status}`);
        }
        
        const services = await servicesResponse.json();
        const xmrtService = services.find((s: any) => 
          s.service?.name?.toLowerCase().includes('xmrt') ||
          s.service?.repo?.includes('XMRT-Ecosystem')
        );
        
        if (xmrtService) {
          const serviceId = xmrtService.service.id;
          
          // Get latest deployment
          const deploysResponse = await fetch(`${RENDER_API_BASE}/services/${serviceId}/deploys?limit=1`, {
            headers: {
              "Authorization": `Bearer ${RENDER_API_KEY}`,
              "Content-Type": "application/json"
            }
          });
          
          if (deploysResponse.ok) {
            const deploys = await deploysResponse.json();
            const latestDeploy = deploys[0]?.deploy;
            
            statusReport.components.render_service = {
              status: latestDeploy?.status === 'live' ? 'healthy' : 'degraded',
              service_name: xmrtService.service.name,
              service_url: FLASK_SERVICE_URL,
              latest_deploy: {
                id: latestDeploy?.id,
                status: latestDeploy?.status,
                commit_hash: latestDeploy?.commit?.id?.substring(0, 7),
                commit_message: latestDeploy?.commit?.message,
                deployed_at: latestDeploy?.finishedAt || latestDeploy?.createdAt
              }
            };
          }
        } else {
          statusReport.components.render_service = {
            status: 'unknown',
            error: 'XMRT service not found in Render'
          };
        }
      } catch (error) {
        statusReport.components.render_service = {
          status: 'error',
          error: (error as Error).message
        };
      }
    } else {
      statusReport.components.render_service = {
        status: 'not_configured',
        error: 'RENDER_API_KEY not set'
      };
    }
    
    // 6. Check Activity Log for Recent Errors
    console.log('📜 Checking recent activity logs...');
    try {
      const { data: recentActivity, error: activityError } = await supabase
        .from('eliza_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (activityError) throw activityError;
      
      const pendingCount = recentActivity?.filter((a: any) => a.status === 'pending').length || 0;
      const failedCount = recentActivity?.filter((a: any) => a.status === 'failed').length || 0;
      
      statusReport.components.activity_log = {
        status: failedCount > 10 ? 'degraded' : 'healthy',
        recent_activities: recentActivity?.slice(0, 5).map((a: any) => ({
          type: a.activity_type,
          title: a.title,
          status: a.status,
          created_at: a.created_at
        })),
        stats: {
          pending: pendingCount,
          failed: failedCount
        }
      };
      
      if (failedCount > 10) {
        statusReport.overall_status = 'degraded';
      }
    } catch (error) {
      statusReport.components.activity_log = {
        status: 'error',
        error: (error as Error).message
      };
    }
    
    // 7. Generate Health Summary
    const healthyComponents = Object.values(statusReport.components).filter(
      (c: any) => c.status === 'healthy'
    ).length;
    const totalComponents = Object.keys(statusReport.components).length;
    
    statusReport.health_score = Math.round((healthyComponents / totalComponents) * 100);
    
    if (statusReport.health_score < 50) {
      statusReport.overall_status = 'unhealthy';
    } else if (statusReport.health_score < 80) {
      statusReport.overall_status = 'degraded';
    }
    
    console.log(`✅ System Status Check Complete - Overall: ${statusReport.overall_status} (${statusReport.health_score}% healthy)`);
    
    return new Response(
      JSON.stringify({
        success: true,
        status: statusReport
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("System status check error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        status: {
          overall_status: 'error',
          timestamp: new Date().toISOString()
        }
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
