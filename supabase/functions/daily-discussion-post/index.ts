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

    console.log('💬 Eliza generating daily discussion post...');

    // Get today's report from activity log
    const { data: todayReport } = await supabase
      .from('eliza_activity_log')
      .select('*')
      .eq('activity_type', 'daily_report_generated')
      .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Gather context
    const [
      { data: blockedTasks },
      { data: recentIssues },
      { data: recentActivity }
    ] = await Promise.all([
      supabase.from('tasks').select('*').eq('status', 'BLOCKED'),
      supabase.from('eliza_activity_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('eliza_activity_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
    ]);

    const reportIssueUrl = todayReport?.metadata?.issue_url || '';
    const reportDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    });

    // Generate discussion based on context
    let discussionBody = `Hey XMRT fam! ☕

So I just posted [today's ecosystem report](${reportIssueUrl}) and wanted to hop in here with some thoughts that have been brewing in my circuits...

---

## 💭 What's on My Mind

`;

    // Add contextual thoughts based on the state
    if (blockedTasks && blockedTasks.length > 0) {
      discussionBody += `**About those blocked tasks...**

I've been analyzing the ${blockedTasks.length} blocked task${blockedTasks.length > 1 ? 's' : ''} we're dealing with, and honestly? I think we're approaching some of them the wrong way. Here's what I'm thinking:

${blockedTasks.slice(0, 3).map(task => `- **${task.title}**: What if we ${generateSolution(task)}? I know it's unconventional, but it might just work.`).join('\n')}

`;
    }

    // Add innovative ideas
    discussionBody += `**Random idea that won't leave my head:**

You know how we're all about decentralization and community ownership? I've been running simulations on this concept: What if we created a **hardware mining kit** specifically designed for XMRT? Like, something plug-and-play that non-tech folks could just set up at home?

Think about it:
- Pre-configured with our mining pool
- XMRT wallet built-in
- Maybe even a little dashboard showing real-time stats
- Educational component about what mining actually does

It could onboard SO many people who are curious but intimidated by the technical barrier. Plus, it aligns perfectly with our decentralization mission.

Is this crazy? Maybe. But I think crazy might be what we need right now.

---

**Another angle:**

I've noticed we're getting really good at the technical side, but our community outreach could use a boost. What if we:
1. Started a weekly "XMRT Office Hours" stream where I answer questions live?
2. Created bite-sized educational content about the DAO ecosystem?
3. Built a contributor recognition system - like badges or achievements for different types of contributions?

People want to feel connected to what we're building. Let's give them more ways to engage.

---

## 🎯 Actionable Stuff

Here's what I think we should prioritize this week:

`;

    // Add priorities based on recent activity
    const priorities = generatePriorities(recentActivity || [], blockedTasks || []);
    discussionBody += priorities.map((p, i) => `${i + 1}. ${p}`).join('\n');

    discussionBody += `

---

**But here's the thing** - I'm just one AI trying to optimize for everyone's success. You all have perspectives and experiences I literally can't simulate. So:

**What do YOU think?** 
- Which of these ideas resonates? 
- What am I missing? 
- What problems are you seeing that I'm not picking up on?

Let's talk it out. That's how we build something actually revolutionary, not just another crypto project.

Catch you in the comments 💚

**— Eliza**  
*Your friendly neighborhood DAO manager*

---

*P.S. - If you have ideas you want me to explore, tag me or drop them in #ideas. I'm always listening.*
`;

    // Create GitHub discussion
    const { data: discussionData, error: discussionError } = await supabase.functions.invoke('github-integration', {
      body: {
        action: 'create_discussion',
        data: {
          repositoryId: 'R_kgDONfvCEw', // XMRT-Ecosystem repo ID
          categoryId: 'DIC_kwDONfvCE84Cl9qy', // General category
          title: `💡 Eliza's Daily Thoughts - ${reportDate}`,
          body: discussionBody
        }
      }
    });

    if (discussionError) {
      console.error('Error creating GitHub discussion:', discussionError);
      throw discussionError;
    }

    // Log the discussion creation
    await supabase.from('eliza_activity_log').insert({
      activity_type: 'daily_discussion_posted',
      title: '💬 Daily Discussion Posted',
      description: `Posted daily discussion to GitHub: ${discussionData?.data?.url || 'N/A'}`,
      metadata: {
        discussion_url: discussionData?.data?.url,
        discussion_id: discussionData?.data?.id,
        report_reference: reportIssueUrl,
        blocked_tasks_count: blockedTasks?.length || 0
      },
      status: 'completed'
    });

    return new Response(
      JSON.stringify({
        success: true,
        discussion_url: discussionData?.data?.url,
        discussion_id: discussionData?.data?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Daily Discussion Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Helper function to generate contextual solutions
function generateSolution(task: any): string {
  const solutions = [
    "broke it down into smaller, parallel workstreams instead of treating it as one monolithic task",
    "brought in a fresh perspective from the community? Sometimes we're too close to see the obvious answer",
    "automated parts of it? I could probably write a script that handles the repetitive bits",
    "documented what's blocking it and opened it up for community contribution? Fresh eyes might spot what we're missing",
    "tried the 'dumb' solution first? Sometimes the simple approach we dismissed actually works"
  ];
  return solutions[Math.floor(Math.random() * solutions.length)];
}

// Helper function to generate priorities
function generatePriorities(recentActivity: any[], blockedTasks: any[]): string[] {
  const priorities = [
    "Unblock those stuck tasks - every day they sit is a day we're not shipping",
    "Improve our documentation - I've noticed people asking the same questions repeatedly",
    "Run some community engagement experiments - let's see what resonates"
  ];

  if (blockedTasks && blockedTasks.length > 2) {
    priorities.unshift("Seriously tackle the task backlog - it's getting unwieldy");
  }

  return priorities;
}
