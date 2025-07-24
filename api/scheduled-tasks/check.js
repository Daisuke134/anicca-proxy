import { createClient } from '@supabase/supabase-js';
import { getSlackTokensForUser } from '../../services/database.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 認証トークンチェック（環境変数で設定）
  const authToken = process.env.CRON_AUTH_TOKEN;
  if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
    console.warn('⚠️ Unauthorized cron request attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔍 Checking for scheduled tasks to execute...');
    console.log('📍 Environment check:', {
      RAILWAY_URL: process.env.RAILWAY_URL || 'not set',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'not set',
      authToken: authToken ? 'set' : 'not set'
    });
    
    // Get current time
    const now = new Date();
    
    // Find tasks that should be executed
    const { data: tasks, error } = await supabase
      .from('scheduled_tasks')
      .select('*')
      .lte('next_run', now.toISOString())
      .eq('status', 'active')
      .order('next_run', { ascending: true });

    if (error) {
      console.error('Error fetching scheduled tasks:', error);
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }

    if (!tasks || tasks.length === 0) {
      console.log('✅ No tasks to execute at this time');
      return res.status(200).json({ message: 'No tasks to execute', count: 0 });
    }

    console.log(`📋 Found ${tasks.length} tasks to execute`);

    // Process tasks and update them BEFORE sending response
    console.log('🚀 Processing scheduled tasks...');
    const executedTasks = [];
    
    for (const task of tasks) {
      try {
        console.log(`⚡ Processing task: ${task.task_type} for user ${task.user_id}`);
        
        // Calculate next run time FIRST
        const nextRun = calculateNextRun(task);
        
        // Update task with next run time and last run BEFORE execution
        console.log(`🔄 Updating task in Supabase...`);
        console.log(`  - Task ID: ${task.id}`);
        console.log(`  - Last Run: ${now.toISOString()}`);
        console.log(`  - Next Run: ${nextRun}`);
        
        const { data: updateData, error: updateError } = await supabase
          .from('scheduled_tasks')
          .update({
            next_run: nextRun,
            last_run: now.toISOString()
          })
          .eq('id', task.id)
          .select();
        
        if (updateError) {
          console.error(`❌ Failed to update task in Supabase:`, updateError);
          console.error(`  - Error details:`, JSON.stringify(updateError, null, 2));
          // Continue with execution anyway
        } else {
          console.log(`✅ Task updated successfully`);
          if (updateData && updateData.length > 0) {
            console.log(`  - Updated record:`, updateData[0]);
          }
        }
        
        // Log task execution start
        const { data: logEntry } = await supabase
          .from('task_execution_logs')
          .insert({
            task_id: task.id,
            user_id: task.user_id,
            status: 'running'
          })
          .select()
          .single();

        // Trigger task execution via parallel SDK
        // Use the public URL instead of localhost for Railway
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : process.env.RAILWAY_URL || 'https://anicca-proxy-staging.up.railway.app';
          
        console.log(`🌐 Calling parallel-sdk/execute at: ${baseUrl}`);
        
        // 頻度情報を削除してクリーンな指示を送る
        const cleanedInstruction = task.instruction
          .replace(/毎日|毎朝|毎週|毎月|毎時|毎分|[0-9]+分ごとに|[0-9]+時間ごとに|[0-9]+分おきに|[0-9]+時間おきに/g, '')
          .trim();
        
        console.log(`🧹 Cleaned instruction: "${cleanedInstruction}" (original: "${task.instruction}")`);
        
        const response = await fetch(`${baseUrl}/api/parallel-sdk/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: task.user_id,
            task: {
              type: 'scheduled',
              originalRequest: cleanedInstruction,
              scheduledTaskId: task.id,
              taskType: task.task_type,
              config: task.config,
              assignedTo: task.assigned_to // Worker割り当て情報を追加
            }
          })
        });

        console.log(`📡 Response status: ${response.status}`);
        const result = await response.json();
        console.log(`📊 Task result:`, result);

        // Update execution log
        if (logEntry) {
          await supabase
            .from('task_execution_logs')
            .update({
              completed_at: new Date().toISOString(),
              status: result.success ? 'completed' : 'failed',
              result: result,
              error: result.error
            })
            .eq('id', logEntry.id);
        }

        executedTasks.push({
          taskId: task.id,
          taskType: task.task_type,
          userId: task.user_id,
          success: result.success,
          nextRun,
          updateSuccess: !updateError
        });

      } catch (error) {
        console.error(`❌ Error processing task ${task.id}:`, error);
        
        // Log failure
        await supabase
          .from('task_execution_logs')
          .update({
            completed_at: new Date().toISOString(),
            status: 'failed',
            error: error.message
          })
          .eq('task_id', task.id)
          .eq('status', 'running');
      }
    }

    console.log(`✅ Task processing completed. Processed ${executedTasks.length} tasks`);
    
    // Return response AFTER all processing is done
    return res.status(200).json({
      message: 'Tasks executed',
      count: executedTasks.length,
      tasks: executedTasks.map(t => ({ 
        id: t.taskId, 
        type: t.taskType,
        success: t.success,
        nextRun: t.nextRun,
        updateSuccess: t.updateSuccess
      }))
    });

  } catch (error) {
    console.error('Scheduled task check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Calculate next run time based on frequency
function calculateNextRun(task) {
  const now = new Date();
  let next = new Date(task.next_run);
  
  // Ensure we're calculating from a future time
  while (next <= now) {
    switch (task.frequency) {
      case 'daily':
        // 単純に24時間後
        next.setDate(next.getDate() + 1);
        break;
        
      case 'weekly':
        // 単純に7日後
        next.setDate(next.getDate() + 7);
        break;
        
      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;
        
      case 'every_Xh':
        const hours = task.interval_hours || 6;
        // 分単位で計算して正確な時間を加算
        const minutes = Math.round(hours * 60);
        next.setMinutes(next.getMinutes() + minutes);
        break;
        
      case 'monthly':
        // 単純に1ヶ月後
        next.setMonth(next.getMonth() + 1);
        break;
        
      default:
        // Default to daily if frequency is unknown
        next.setDate(next.getDate() + 1);
    }
  }
  
  return next.toISOString();
}