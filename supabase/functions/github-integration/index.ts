import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const GITHUB_CLIENT_ID = Deno.env.get('GITHUB_CLIENT_ID');
const GITHUB_CLIENT_SECRET = Deno.env.get('GITHUB_CLIENT_SECRET');
const GITHUB_OWNER = Deno.env.get('GITHUB_OWNER') || 'DevGruGold';
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') || 'XMRT-Ecosystem';

// Validate required environment variables
function validateGitHubConfig(): void {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured');
  }
  console.log(`✅ GitHub OAuth configured - Owner: ${GITHUB_OWNER}, Repo: ${GITHUB_REPO}`);
}

// Exchange OAuth code for access token
async function getAccessToken(code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code: code,
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`OAuth error: ${data.error_description || data.error}`);
  }
  
  if (!data.access_token) {
    throw new Error('No access token received from GitHub');
  }
  
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate GitHub configuration
    validateGitHubConfig();

    const requestBody = await req.json();
    const { action, data, code } = requestBody;
    
    console.log(`🔧 GitHub Integration - Action: ${action}`, data);

    // Handle OAuth callback
    if (action === 'oauth_callback') {
      if (!code) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Missing OAuth code' 
          }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      const accessToken = await getAccessToken(code);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          access_token: accessToken,
          message: 'OAuth authentication successful' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Validate action exists
    if (!action) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required field: action' 
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Try OAuth access token first, fallback to GITHUB_TOKEN secret
    const accessToken = data?.access_token || Deno.env.get('GITHUB_TOKEN');
    if (!accessToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing access_token. Please authenticate first using oauth_callback action or configure GITHUB_TOKEN secret.' 
        }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Use OAuth access token or PAT for authentication
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    let result;

    switch (action) {
      case 'list_issues':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}/issues?state=${data?.state || 'open'}&per_page=${data?.per_page || 30}`,
          { headers }
        );
        break;

      case 'create_issue':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/issues`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: data.title,
              body: data.body,
              labels: data.labels || [],
              assignees: data.assignees || [],
            }),
          }
        );
        break;

      case 'comment_on_issue':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/issues/${data.issue_number}/comments`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ body: data.comment }),
          }
        );
        break;

      case 'list_discussions':
        // GraphQL query for discussions
        result = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: `
              query {
                repository(owner: "${GITHUB_OWNER}", name: "${data?.repo || GITHUB_REPO}") {
                  discussions(first: ${data?.first || 20}) {
                    nodes {
                      id
                      title
                      body
                      createdAt
                      author { login }
                      comments(first: 5) {
                        nodes {
                          body
                          author { login }
                        }
                      }
                    }
                  }
                }
              }
            `,
          }),
        });
        break;

      case 'create_discussion':
        // Step 1: Get repository ID and available discussion categories
        const repoInfoQuery = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: `
              query {
                repository(owner: "${GITHUB_OWNER}", name: "${data.repo || GITHUB_REPO}") {
                  id
                  discussionCategories(first: 20) {
                    nodes {
                      id
                      name
                    }
                  }
                }
              }
            `,
          }),
        });
        
        const repoInfo = await repoInfoQuery.json();
        console.log('📦 Repository info for discussion:', repoInfo);
        
        if (repoInfo.errors) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Failed to fetch repository info',
              details: repoInfo.errors
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        const repository = repoInfo.data?.repository;
        if (!repository) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `Repository ${GITHUB_OWNER}/${data.repo || GITHUB_REPO} not found or discussions not enabled`
            }),
            { 
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        const repositoryId = repository.id;
        const categories = repository.discussionCategories.nodes;
        
        // Step 2: Find matching category (case-insensitive match)
        const categoryName = (data.category || 'General').toLowerCase();
        const matchedCategory = categories.find(
          (cat: any) => cat.name.toLowerCase() === categoryName
        ) || categories.find(
          (cat: any) => cat.name.toLowerCase().includes('general')
        ) || categories[0]; // Fallback to first category
        
        if (!matchedCategory) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'No discussion categories available. Please enable discussions on the repository.',
              availableCategories: categories.map((c: any) => c.name)
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        console.log(`📝 Creating discussion in category: ${matchedCategory.name} (${matchedCategory.id})`);
        
        // Step 3: Create the discussion with escaped strings
        const discussionTitle = (data.title || 'Untitled Discussion').replace(/"/g, '\\"');
        const discussionBody = (data.body || 'No description provided.').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        
        result = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: `
              mutation {
                createDiscussion(input: {
                  repositoryId: "${repositoryId}",
                  categoryId: "${matchedCategory.id}",
                  title: "${discussionTitle}",
                  body: "${discussionBody}"
                }) {
                  discussion {
                    id
                    title
                    url
                    category {
                      name
                    }
                  }
                }
              }
            `,
          }),
        });
        break;

      case 'get_repo_info':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}`,
          { headers }
        );
        break;

      case 'list_pull_requests':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}/pulls?state=${data?.state || 'open'}`,
          { headers }
        );
        break;

      case 'create_pull_request':
        if (!data.title || !data.head || !data.base) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required fields for create_pull_request: title, head, base' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/pulls`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: data.title,
              body: data.body || 'No description provided.',
              head: data.head,
              base: data.base || 'main',
              draft: data.draft || false,
            }),
          }
        );
        break;

      case 'get_file_content':
        const fileResult = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/contents/${data.path}${data.branch ? `?ref=${data.branch}` : ''}`,
          { headers }
        );
        
        if (!fileResult.ok) {
          const errorData = await fileResult.json();
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `File not found: ${data.path}`,
              details: errorData
            }),
            { 
              status: fileResult.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        const fileData = await fileResult.json();
        
        // Decode base64 content and format for user display
        if (fileData.content && fileData.encoding === 'base64') {
          try {
            const decodedContent = atob(fileData.content.replace(/\n/g, ''));
            const lines = decodedContent.split('\n').length;
            const sizeKB = (decodedContent.length / 1024).toFixed(2);
            
            // Return user-friendly summary instead of raw data
            fileData.userFriendly = {
              summary: `📄 Retrieved file: **${fileData.name}**\n\n` +
                       `📁 Path: \`${fileData.path}\`\n` +
                       `📏 Size: ${sizeKB} KB (${lines} lines)\n` +
                       `🔗 [View on GitHub](${fileData.html_url || `https://github.com/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/blob/${data.branch || 'main'}/${data.path}`})`,
              content: decodedContent,
              metadata: {
                lines,
                sizeKB,
                path: fileData.path,
                name: fileData.name
              }
            };
            // Keep raw content for programmatic access
            fileData.decodedContent = decodedContent;
          } catch (e) {
            console.warn('Failed to decode file content:', e);
          }
        }
        
        result = { ok: true, json: async () => fileData };
        break;

      case 'commit_file':
        // First, try to get the existing file to get its SHA (for updates)
        let fileSha = data.sha;
        let isUpdate = false;
        
        if (!fileSha) {
          try {
            const existingFile = await fetch(
              `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/contents/${data.path}${data.branch ? `?ref=${data.branch}` : ''}`,
              { headers }
            );
            
            if (existingFile.ok) {
              const existingData = await existingFile.json();
              fileSha = existingData.sha;
              isUpdate = true;
              console.log(`📝 Updating existing file: ${data.path} (SHA: ${fileSha})`);
            } else {
              console.log(`📝 Creating new file: ${data.path}`);
            }
          } catch (e) {
            console.log(`📝 Creating new file: ${data.path} (couldn't check if exists)`);
          }
        }
        
        const commitBody: any = {
          message: data.message,
          content: btoa(data.content), // Base64 encode
          branch: data.branch || 'main',
        };
        
        // Only include SHA if we're updating an existing file
        if (fileSha) {
          commitBody.sha = fileSha;
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/contents/${data.path}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify(commitBody),
          }
        );
        
        // Add user-friendly formatting to commit result
        if (result.ok) {
          const commitData = await result.json();
          const contentLines = data.content.split('\n').length;
          const contentSize = (data.content.length / 1024).toFixed(2);
          
          commitData.userFriendly = {
            summary: `✅ **${isUpdate ? 'Updated' : 'Created'} file successfully**\n\n` +
                     `📄 File: \`${data.path}\`\n` +
                     `📏 Size: ${contentSize} KB (${contentLines} lines)\n` +
                     `🌿 Branch: \`${data.branch || 'main'}\`\n` +
                     `💬 Commit: "${data.message}"\n` +
                     `🔗 [View commit](${commitData.commit?.html_url || `https://github.com/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}`})`,
            action: isUpdate ? 'updated' : 'created',
            metadata: {
              path: data.path,
              branch: data.branch || 'main',
              lines: contentLines,
              sizeKB: contentSize
            }
          };
          
          result = { ok: true, json: async () => commitData };
        }
        break;

      case 'search_code':
        if (!data.query) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: query' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/search/code?q=${encodeURIComponent(data.query)}+repo:${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}`,
          { headers }
        );
        break;

      case 'update_issue':
        if (!data.issue_number) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: issue_number' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        const updateBody: any = {};
        if (data.title) updateBody.title = data.title;
        if (data.body !== undefined) updateBody.body = data.body;
        if (data.state) updateBody.state = data.state;
        if (data.labels) updateBody.labels = data.labels;
        if (data.assignees) updateBody.assignees = data.assignees;
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/issues/${data.issue_number}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify(updateBody),
          }
        );
        break;

      case 'close_issue':
        if (!data.issue_number) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: issue_number' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/issues/${data.issue_number}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ state: 'closed' }),
          }
        );
        break;

      case 'add_comment':
        if (!data.issue_number || !data.comment) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required fields: issue_number, comment' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/issues/${data.issue_number}/comments`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ body: data.comment }),
          }
        );
        break;

      case 'merge_pull_request':
        if (!data.pull_number) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: pull_number' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/pulls/${data.pull_number}/merge`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              commit_title: data.commit_title,
              commit_message: data.commit_message,
              merge_method: data.merge_method || 'merge', // merge, squash, or rebase
            }),
          }
        );
        break;

      case 'close_pull_request':
        if (!data.pull_number) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: pull_number' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/pulls/${data.pull_number}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ state: 'closed' }),
          }
        );
        break;

      case 'delete_file':
        if (!data.path || !data.message) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required fields: path, message' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        // Get file SHA first (required for deletion)
        let deleteFileSha = data.sha;
        if (!deleteFileSha) {
          const existingFileForDelete = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/contents/${data.path}${data.branch ? `?ref=${data.branch}` : ''}`,
            { headers }
          );
          
          if (existingFileForDelete.ok) {
            const existingData = await existingFileForDelete.json();
            deleteFileSha = existingData.sha;
          } else {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: `File not found: ${data.path}` 
              }),
              { 
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/contents/${data.path}`,
          {
            method: 'DELETE',
            headers,
            body: JSON.stringify({
              message: data.message,
              sha: deleteFileSha,
              branch: data.branch || 'main',
            }),
          }
        );
        break;

      case 'list_files':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}/contents/${data?.path || ''}${data?.branch ? `?ref=${data.branch}` : ''}`,
          { headers }
        );
        break;

      case 'create_branch':
        if (!data.branch_name || !data.from_branch) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required fields: branch_name, from_branch' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        // Get the SHA of the source branch
        const refResult = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/git/refs/heads/${data.from_branch}`,
          { headers }
        );
        
        if (!refResult.ok) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `Source branch not found: ${data.from_branch}` 
            }),
            { 
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        const refData = await refResult.json();
        const sha = refData.object.sha;
        
        // Create new branch
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/git/refs`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ref: `refs/heads/${data.branch_name}`,
              sha: sha,
            }),
          }
        );
        break;

      case 'get_branch_info':
        if (!data.branch_name) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Missing required field: branch_name' 
            }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data.repo || GITHUB_REPO}/branches/${data.branch_name}`,
          { headers }
        );
        break;

      case 'list_branches':
        result = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}/branches?per_page=${data?.per_page || 30}`,
          { headers }
        );
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Handle special case where we manually created the result object
    let responseData;
    if (typeof result.json === 'function') {
      responseData = await result.json();
    } else {
      responseData = result;
    }

    if (!result.ok) {
      console.error('GitHub API Error:', responseData);
      
      // Return detailed error info instead of throwing
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: responseData.message || responseData.error || 'GitHub API request failed',
          status: result.status,
          needsAuth: result.status === 401,
          details: responseData
        }),
        { 
          status: result.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`✅ GitHub Integration - Success: ${action}`);

    // Format response for user-friendly display
    let userFriendlyMessage = '';
    switch (action) {
      case 'create_issue':
        userFriendlyMessage = `✅ Created issue #${responseData.number}: "${responseData.title}" in ${GITHUB_OWNER}/${data?.repo || GITHUB_REPO}`;
        break;
      case 'create_discussion':
        userFriendlyMessage = `✅ Created discussion: "${responseData.discussion?.title}" in category ${responseData.discussion?.category?.name}`;
        break;
      case 'commit_file':
        userFriendlyMessage = `✅ Successfully committed "${data.path}" to ${data.branch || 'main'} branch`;
        break;
      case 'create_pull_request':
        userFriendlyMessage = `✅ Created pull request #${responseData.number}: "${responseData.title}" (${responseData.head.ref} → ${responseData.base.ref})`;
        break;
      case 'get_repo_info':
        userFriendlyMessage = `📊 Repository: ${responseData.full_name}\n⭐ Stars: ${responseData.stargazers_count} | 🍴 Forks: ${responseData.forks_count} | 🐛 Open Issues: ${responseData.open_issues_count}`;
        break;
      case 'get_file_content':
        userFriendlyMessage = `📄 Retrieved file: ${responseData.path} (${responseData.size} bytes)`;
        break;
      case 'list_issues':
        userFriendlyMessage = `📋 Found ${responseData.length} issue(s)`;
        break;
      case 'list_pull_requests':
        userFriendlyMessage = `🔀 Found ${responseData.length} pull request(s)`;
        break;
      case 'search_code':
        userFriendlyMessage = `🔍 Found ${responseData.total_count} code match(es)`;
        break;
      default:
        userFriendlyMessage = `✅ Successfully completed: ${action}`;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: responseData,
        userFriendlyMessage,
        action
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('GitHub Integration Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
