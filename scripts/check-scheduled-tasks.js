// Script to be called by Railway Cron to check and execute scheduled tasks
async function checkScheduledTasks() {
  try {
    console.log('🕐 Starting scheduled task check...');
    
    // Call the API endpoint to check and execute tasks
    const apiUrl = process.env.RAILWAY_URL || 'http://localhost:3838';
    const response = await fetch(`${apiUrl}/api/scheduled-tasks/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || 'default-secret'
      }
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ Task check completed. Executed ${result.executedCount} tasks.`);
      if (result.tasks && result.tasks.length > 0) {
        console.log('📋 Executed tasks:', result.tasks);
      }
    } else {
      console.error('❌ Task check failed:', result.error);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error checking scheduled tasks:', error);
    process.exit(1);
  }
}

// Run the check
checkScheduledTasks().then(() => {
  console.log('✅ Cron job completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('❌ Cron job failed:', error);
  process.exit(1);
});