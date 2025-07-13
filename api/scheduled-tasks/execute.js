import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // シークレットキー認証
  const secretKey = req.headers['x-secret-key'];
  if (secretKey !== process.env.SCHEDULED_TASKS_SECRET) {
    console.error('Unauthorized access attempt to scheduled tasks execute endpoint');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔍 Checking for scheduled tasks to execute...');
    
    // 現在時刻を取得
    const now = new Date();
    
    // 実行すべきタスクを取得
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
      return res.status(200).json({ 
        success: true,
        message: 'No tasks to execute', 
        count: 0 
      });
    }

    console.log(`📋 Found ${tasks.length} tasks to execute`);

    // 各タスクを処理
    const results = [];
    
    for (const task of tasks) {
      try {
        console.log(`⚡ Executing task: ${task.task_type} for user ${task.user_id}`);
        console.log(`📝 Task instruction: ${task.instruction}`);
        
        // タスク実行開始をログに記録
        const { data: logEntry } = await supabase
          .from('task_execution_logs')
          .insert({
            task_id: task.id,
            user_id: task.user_id,
            status: 'running',
            started_at: new Date().toISOString()
          })
          .select()
          .single();

        // SDKにタスクを委譲（全タスクを自然言語で処理）
        let sdkUrl = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_URL || 'https://anicca-proxy-staging.up.railway.app';
        
        // URLにプロトコルがない場合は追加
        if (!sdkUrl.startsWith('http://') && !sdkUrl.startsWith('https://')) {
          sdkUrl = 'https://' + sdkUrl;
        }
        
        console.log(`🔗 Delegating to SDK at: ${sdkUrl}/api/parallel-sdk/execute`);
        
        const response = await fetch(`${sdkUrl}/api/parallel-sdk/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: task.user_id,
            task: {
              type: 'scheduled',
              originalRequest: task.instruction, // 自然言語のままSDKに渡す
              scheduledTaskId: task.id,
              taskType: task.task_type,
              config: task.config
            }
          })
        });

        const result = await response.json();
        const success = response.ok && result.success;

        // 実行ログを更新
        await supabase
          .from('task_execution_logs')
          .update({
            completed_at: new Date().toISOString(),
            status: success ? 'completed' : 'failed',
            result: result,
            error: result.error
          })
          .eq('id', logEntry.id);

        // 次回実行時刻を計算
        const nextRun = calculateNextRun(task);
        console.log(`📅 Next run calculated for task ${task.id}: ${nextRun}`);
        
        // タスクの次回実行時刻とlast_runを更新
        const { error: updateError } = await supabase
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

        results.push({
          taskId: task.id,
          taskType: task.task_type,
          userId: task.user_id,
          success: success,
          nextRun: nextRun
        });

      } catch (error) {
        console.error(`❌ Error executing task ${task.id}:`, error);
        
        // エラーログを記録
        await supabase
          .from('task_execution_logs')
          .insert({
            task_id: task.id,
            user_id: task.user_id,
            status: 'failed',
            error: error.message,
            started_at: now.toISOString(),
            completed_at: new Date().toISOString()
          });

        results.push({
          taskId: task.id,
          taskType: task.task_type,
          userId: task.user_id,
          success: false,
          error: error.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Task execution completed',
      executedCount: results.length,
      results: results
    });

  } catch (error) {
    console.error('Scheduled task execution error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

// 次回実行時刻を計算
function calculateNextRun(task) {
  const now = new Date();
  let next = new Date(task.next_run);
  
  // 現在時刻より未来になるまで繰り返し計算
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
        // デフォルトは日次
        next.setDate(next.getDate() + 1);
    }
  }
  
  return next.toISOString();
}