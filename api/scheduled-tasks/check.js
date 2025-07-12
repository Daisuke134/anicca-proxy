import { createClient } from '@supabase/supabase-js';
import { getSlackTokensForUser } from '../../services/database.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Checking for scheduled tasks to execute...');
    
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

    // Process each task
    const executedTasks = [];
    
    for (const task of tasks) {
      try {
        console.log(`⚡ Executing task: ${task.task_type} for user ${task.user_id}`);
        
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
        // In Railway environment, use the public URL instead of localhost
        const apiUrl = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_URL || 'http://localhost:3838';
        console.log(`🔗 Calling parallel SDK at: ${apiUrl}/api/parallel-sdk/execute`);
        
        const response = await fetch(`${apiUrl}/api/parallel-sdk/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: task.user_id,
            task: {
              type: 'scheduled',
              originalRequest: task.instruction,
              scheduledTaskId: task.id,
              taskType: task.task_type,
              config: task.config
            }
          })
        });

        const result = await response.json();

        // Update execution log
        await supabase
          .from('task_execution_logs')
          .update({
            completed_at: new Date().toISOString(),
            status: result.success ? 'completed' : 'failed',
            result: result,
            error: result.error
          })
          .eq('id', logEntry.id);

        // Calculate next run time
        const nextRun = calculateNextRun(task);
        console.log(`📅 Next run calculated for task ${task.id}: ${nextRun}`);
        
        // Update task with next run time and last run
        const { data: updateData, error: updateError } = await supabase
          .from('scheduled_tasks')
          .update({
            next_run: nextRun,
            last_run: now.toISOString()
          })
          .eq('id', task.id);
        
        if (updateError) {
          console.error(`❌ Failed to update task ${task.id}:`, updateError);
        } else {
          console.log(`✅ Updated task ${task.id} - last_run: ${now.toISOString()}, next_run: ${nextRun}`);
        }

        executedTasks.push({
          taskId: task.id,
          taskType: task.task_type,
          userId: task.user_id,
          success: result.success,
          nextRun
        });

      } catch (error) {
        console.error(`❌ Error executing task ${task.id}:`, error);
        
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

    return res.status(200).json({
      message: 'Task check completed',
      executedCount: executedTasks.length,
      tasks: executedTasks
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
        next.setDate(next.getDate() + 1);
        break;
        
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
        
      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;
        
      case 'every_Xh':
        const hours = task.interval_hours || 6;
        next.setHours(next.getHours() + hours);
        break;
        
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
        
      default:
        // Default to daily if frequency is unknown
        next.setDate(next.getDate() + 1);
    }
  }
  
  return next.toISOString();
}