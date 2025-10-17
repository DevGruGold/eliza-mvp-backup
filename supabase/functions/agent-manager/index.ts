import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, data } = await req.json();
    console.log(`Agent Manager - Action: ${action}`, data);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let result;

    switch (action) {
      case 'list_agents':
        const { data: agents, error: listError } = await supabase
          .from('agents')
          .select('*')
          .order('created_at', { ascending: false });
        
        console.log('🔍 [agent-manager] list_agents - DB query result:', {
          agentsCount: agents?.length || 0,
          agents: agents,
          error: listError
        });
        
        if (listError) throw listError;
        result = agents;
        console.log('🔍 [agent-manager] list_agents - Setting result:', result);
        break;

      case 'spawn_agent':
        // Check if agent with this name already exists
        const { data: existingAgent, error: checkError } = await supabase
          .from('agents')
          .select('*')
          .eq('name', data.name)
          .maybeSingle();
        
        if (checkError) throw checkError;
        
        // If agent already exists, return it instead of creating duplicate
        if (existingAgent) {
          console.log('Agent already exists, returning existing:', existingAgent);
          result = {
            ...existingAgent,
            message: 'Agent already exists with this name',
            wasExisting: true
          };
          break;
        }
        
        // Create new agent
        const { data: newAgent, error: spawnError } = await supabase
          .from('agents')
          .insert({
            id: data.id || `agent-${Date.now()}`,
            name: data.name,
            role: data.role,
            status: 'IDLE',
            skills: data.skills || [],
          })
          .select()
          .single();
        
        if (spawnError) throw spawnError;
        
        // Log the decision to spawn this agent
        await supabase.from('decisions').insert({
          id: `decision-${Date.now()}`,
          agent_id: 'eliza',
          decision: `Spawned new agent: ${newAgent.name}`,
          rationale: data.rationale || 'Agent spawned for task delegation',
        });
        
        // Log to activity log
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'agent_spawned',
          title: `Spawned Agent: ${newAgent.name}`,
          description: `Role: ${newAgent.role}`,
          metadata: { agent_id: newAgent.id, skills: newAgent.skills },
          status: 'completed'
        });
        
        result = newAgent;
        console.log('New agent spawned:', newAgent);
        break;

      case 'update_agent_status':
        const { data: updatedAgent, error: updateError } = await supabase
          .from('agents')
          .update({ status: data.status })
          .eq('id', data.agent_id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        result = updatedAgent;
        break;

      case 'assign_task':
        // Check if task with same title and assignee already exists
        const { data: existingTask, error: existingTaskError } = await supabase
          .from('tasks')
          .select('*')
          .eq('title', data.title)
          .eq('assignee_agent_id', data.assignee_agent_id)
          .in('status', ['PENDING', 'IN_PROGRESS'])
          .maybeSingle();
        
        if (existingTaskError) throw existingTaskError;
        
        // If task already exists, return it instead of creating duplicate
        if (existingTask) {
          console.log('Task already exists, returning existing:', existingTask);
          result = {
            ...existingTask,
            message: 'Task already exists',
            wasExisting: true
          };
          break;
        }
        
        const { data: task, error: taskError } = await supabase
          .from('tasks')
          .insert({
            id: data.task_id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: data.title,
            description: data.description,
            repo: data.repo || 'xmrt-ecosystem',
            category: data.category,
            stage: data.stage || 'PLANNING',
            status: 'PENDING',
            priority: data.priority || 5,
            assignee_agent_id: data.assignee_agent_id,
          })
          .select()
          .single();
        
        if (taskError) throw taskError;
        
        // Update agent status to BUSY
        await supabase
          .from('agents')
          .update({ status: 'BUSY' })
          .eq('id', data.assignee_agent_id);
        
        // Log to activity log
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'task_created',
          title: `Created Task: ${task.title}`,
          description: task.description,
          metadata: {
            task_id: task.id,
            assignee: data.assignee_agent_id,
            category: task.category,
            stage: task.stage
          },
          status: 'completed'
        });
        
        result = task;
        console.log('Task assigned:', task);
        break;

      case 'list_tasks':
        const { data: tasks, error: tasksError } = await supabase
          .from('tasks')
          .select('*')
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false });
        
        if (tasksError) throw tasksError;
        result = tasks;
        break;

      case 'update_task_status':
        const { data: updatedTask, error: taskUpdateError } = await supabase
          .from('tasks')
          .update({ 
            status: data.status,
            stage: data.stage,
          })
          .eq('id', data.task_id)
          .select()
          .single();
        
        if (taskUpdateError) throw taskUpdateError;
        
        // Log to activity log
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'task_updated',
          title: `Updated Task: ${updatedTask.title}`,
          description: `Status: ${data.status}, Stage: ${data.stage}`,
          metadata: {
            task_id: updatedTask.id,
            old_status: data.old_status,
            new_status: data.status,
            stage: data.stage
          },
          status: 'completed'
        });

        // If task is completed, free up the agent for new assignments
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          await supabase
            .from('agents')
            .update({ status: 'IDLE' })
            .eq('id', updatedTask.assignee_agent_id);
          
          console.log(`✅ Agent ${updatedTask.assignee_agent_id} marked IDLE after task completion`);
        }
        
        result = updatedTask;
        break;

      case 'report_progress':
        // Agent reports progress to lead agent
        const progressLog = await supabase.from('eliza_activity_log').insert({
          activity_type: 'progress_report',
          title: `Progress Report: ${data.agent_name}`,
          description: data.progress_message,
          metadata: {
            agent_id: data.agent_id,
            task_id: data.task_id,
            progress_percentage: data.progress_percentage,
            current_stage: data.current_stage
          },
          status: 'completed'
        });
        
        console.log(`📊 Progress reported by ${data.agent_name}:`, data.progress_message);
        result = { success: true, message: 'Progress reported' };
        break;

      case 'request_assignment':
        // Agent requests new assignment from lead
        const { data: availableTasks, error: availableError } = await supabase
          .from('tasks')
          .select('*')
          .eq('status', 'PENDING')
          .order('priority', { ascending: false })
          .limit(1);
        
        if (availableError) throw availableError;
        
        if (availableTasks && availableTasks.length > 0) {
          const nextTask = availableTasks[0];
          
          // Assign the task
          await supabase
            .from('tasks')
            .update({ 
              status: 'IN_PROGRESS',
              assignee_agent_id: data.agent_id 
            })
            .eq('id', nextTask.id);
          
          // Update agent status
          await supabase
            .from('agents')
            .update({ status: 'BUSY' })
            .eq('id', data.agent_id);
          
          // Log assignment
          await supabase.from('eliza_activity_log').insert({
            activity_type: 'task_assigned',
            title: `Task Assigned: ${nextTask.title}`,
            description: `Assigned to ${data.agent_name}`,
            metadata: {
              task_id: nextTask.id,
              agent_id: data.agent_id
            },
            status: 'completed'
          });
          
          console.log(`📋 Assigned task "${nextTask.title}" to ${data.agent_name}`);
          result = { success: true, task: nextTask };
        } else {
          console.log(`⏸️ No tasks available for ${data.agent_name}`);
          result = { success: false, message: 'No pending tasks available' };
        }
        break;

      case 'get_agent_workload':
        const { data: agentTasks, error: workloadError } = await supabase
          .from('tasks')
          .select('*')
          .eq('assignee_agent_id', data.agent_id)
          .neq('status', 'COMPLETED');
        
        if (workloadError) throw workloadError;
        result = { agent_id: data.agent_id, active_tasks: agentTasks?.length || 0, tasks: agentTasks };
        break;

      case 'log_decision':
        const { data: decision, error: decisionError } = await supabase
          .from('decisions')
          .insert({
            id: `decision-${Date.now()}`,
            agent_id: data.agent_id || 'eliza',
            decision: data.decision,
            rationale: data.rationale,
          })
          .select()
          .single();
        
        if (decisionError) throw decisionError;
        result = decision;
        break;

      case 'update_agent_skills':
        const { data: agentWithUpdatedSkills, error: updateSkillsError } = await supabase
          .from('agents')
          .update({ skills: data.skills })
          .eq('id', data.agent_id)
          .select()
          .single();
        
        if (updateSkillsError) throw updateSkillsError;
        result = { success: true, agent: agentWithUpdatedSkills };
        break;

      case 'update_agent_role':
        const { data: updatedRoleAgent, error: updateRoleError } = await supabase
          .from('agents')
          .update({ role: data.role })
          .eq('id', data.agent_id)
          .select()
          .single();
        
        if (updateRoleError) throw updateRoleError;
        result = { success: true, agent: updatedRoleAgent };
        break;

      case 'delete_agent':
        const { error: deleteAgentError } = await supabase
          .from('agents')
          .delete()
          .eq('id', data.agent_id);
        
        if (deleteAgentError) throw deleteAgentError;
        result = { success: true, message: `Agent ${data.agent_id} deleted` };
        break;

      case 'search_agents':
        let agentQuery = supabase.from('agents').select('*');
        
        if (data.skills) agentQuery = agentQuery.contains('skills', data.skills);
        if (data.role) agentQuery = agentQuery.ilike('role', `%${data.role}%`);
        if (data.status) agentQuery = agentQuery.eq('status', data.status);
        
        const { data: searchedAgents, error: searchAgentsError } = await agentQuery;
        if (searchAgentsError) throw searchAgentsError;
        result = { success: true, agents: searchedAgents };
        break;

      case 'update_task':
        const { data: taskWithUpdates, error: updateTaskError } = await supabase
          .from('tasks')
          .update(data.updates)
          .eq('id', data.task_id)
          .select()
          .single();
        
        if (updateTaskError) throw updateTaskError;
        result = { success: true, task: taskWithUpdates };
        break;

      case 'search_tasks':
        let taskQuery = supabase.from('tasks').select('*');
        
        if (data.category) taskQuery = taskQuery.eq('category', data.category);
        if (data.repo) taskQuery = taskQuery.eq('repo', data.repo);
        if (data.stage) taskQuery = taskQuery.eq('stage', data.stage);
        if (data.status) taskQuery = taskQuery.eq('status', data.status);
        if (data.min_priority) taskQuery = taskQuery.gte('priority', data.min_priority);
        if (data.max_priority) taskQuery = taskQuery.lte('priority', data.max_priority);
        
        const { data: searchedTasks, error: searchTasksError } = await taskQuery;
        if (searchTasksError) throw searchTasksError;
        result = { success: true, tasks: searchedTasks };
        break;

      case 'bulk_update_tasks':
        const { data: bulkUpdated, error: bulkError } = await supabase
          .from('tasks')
          .update(data.updates)
          .in('id', data.task_ids)
          .select();
        
        if (bulkError) throw bulkError;
        result = { success: true, updated_count: bulkUpdated.length, tasks: bulkUpdated };
        break;

      case 'delete_task':
        const { data: deletedTask, error: deleteError } = await supabase
          .from('tasks')
          .delete()
          .eq('id', data.task_id)
          .select()
          .single();
        
        if (deleteError) throw deleteError;
        
        // Log deletion
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'task_deleted',
          title: `Deleted Task: ${deletedTask.title}`,
          description: `Reason: ${data.reason}`,
          metadata: {
            task_id: deletedTask.id,
            reason: data.reason
          },
          status: 'completed'
        });
        
        // Free up the agent if it was assigned
        if (deletedTask.assignee_agent_id) {
          await supabase
            .from('agents')
            .update({ status: 'IDLE' })
            .eq('id', deletedTask.assignee_agent_id);
        }
        
        result = { success: true, deleted_task: deletedTask };
        break;

      case 'reassign_task':
        const { data: taskToReassign, error: fetchError } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', data.task_id)
          .single();
        
        if (fetchError) throw fetchError;
        
        const oldAssignee = taskToReassign.assignee_agent_id;
        
        // Update task assignment
        const { data: reassignedTask, error: reassignError } = await supabase
          .from('tasks')
          .update({ assignee_agent_id: data.new_assignee_id })
          .eq('id', data.task_id)
          .select()
          .single();
        
        if (reassignError) throw reassignError;
        
        // Free up old agent
        if (oldAssignee) {
          await supabase
            .from('agents')
            .update({ status: 'IDLE' })
            .eq('id', oldAssignee);
        }
        
        // Mark new agent as busy
        await supabase
          .from('agents')
          .update({ status: 'BUSY' })
          .eq('id', data.new_assignee_id);
        
        // Log reassignment
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'task_updated',
          title: `Reassigned Task: ${reassignedTask.title}`,
          description: `From ${oldAssignee || 'unassigned'} to ${data.new_assignee_id}. ${data.reason || ''}`,
          metadata: {
            task_id: reassignedTask.id,
            old_assignee: oldAssignee,
            new_assignee: data.new_assignee_id,
            reason: data.reason
          },
          status: 'completed'
        });
        
        result = reassignedTask;
        break;

      case 'update_task_details':
        const updateFields: any = {};
        if (data.title) updateFields.title = data.title;
        if (data.description) updateFields.description = data.description;
        if (data.priority !== undefined) updateFields.priority = data.priority;
        if (data.category) updateFields.category = data.category;
        if (data.repo) updateFields.repo = data.repo;
        
        const { data: detailUpdatedTask, error: detailUpdateError } = await supabase
          .from('tasks')
          .update(updateFields)
          .eq('id', data.task_id)
          .select()
          .single();
        
        if (detailUpdateError) throw detailUpdateError;
        
        // Log update
        await supabase.from('eliza_activity_log').insert({
          activity_type: 'task_updated',
          title: `Updated Task Details: ${detailUpdatedTask.title}`,
          description: `Updated fields: ${Object.keys(updateFields).join(', ')}`,
          metadata: {
            task_id: detailUpdatedTask.id,
            updated_fields: updateFields
          },
          status: 'completed'
        });
        
        result = detailUpdatedTask;
        break;

      case 'get_task_details':
        const { data: taskDetails, error: taskDetailsError } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', data.task_id)
          .single();
        
        if (taskDetailsError) throw taskDetailsError;
        result = taskDetails;
        break;

      case 'cleanup_duplicate_agents':
        // Find all duplicate agents (same name)
        const { data: allAgents, error: agentsFetchError } = await supabase
          .from('agents')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (agentsFetchError) throw agentsFetchError;
        
        // Group by name and keep only the oldest
        const agentsByName = new Map();
        const duplicatesToDelete = [];
        
        for (const agent of allAgents) {
          if (!agentsByName.has(agent.name)) {
            agentsByName.set(agent.name, agent);
          } else {
            duplicatesToDelete.push(agent.id);
          }
        }
        
        // Delete duplicates
        if (duplicatesToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from('agents')
            .delete()
            .in('id', duplicatesToDelete);
          
          if (deleteError) throw deleteError;
          
          // Log the cleanup
          await supabase.from('eliza_activity_log').insert({
            activity_type: 'cleanup',
            title: '🧹 Cleaned up duplicate agents',
            description: `Removed ${duplicatesToDelete.length} duplicate agents`,
            metadata: { deleted_ids: duplicatesToDelete },
            status: 'completed'
          });
        }
        
        result = { 
          success: true, 
          duplicatesRemoved: duplicatesToDelete.length,
          deletedIds: duplicatesToDelete
        };
        console.log('Duplicate agents cleaned up:', duplicatesToDelete);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const responsePayload = { success: true, data: result };
    console.log('🔍 [agent-manager] Final response payload:', {
      action,
      dataType: Array.isArray(result) ? 'array' : typeof result,
      dataLength: Array.isArray(result) ? result.length : 'N/A',
      payload: responsePayload
    });
    
    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Agent Manager Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
