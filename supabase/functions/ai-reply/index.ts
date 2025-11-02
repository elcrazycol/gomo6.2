import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { threadId, replyToId, promptContent } = await req.json();
    
    console.log('AI reply request:', { threadId, replyToId, promptContent });

    const NAGA_API_KEY = Deno.env.get('NAGA_API_KEY');
    if (!NAGA_API_KEY) {
      throw new Error('NAGA_API_KEY not configured');
    }

    // Call Naga AI API
    const aiResponse = await fetch('https://api.naga.ac/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NAGA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v3.2-exp',
        messages: [
          { role: 'user', content: promptContent }
        ],
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Naga API error:', errorText);
      throw new Error(`Naga API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices[0].message.content;

    console.log('AI response:', aiContent);

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create AI user if doesn't exist
    let aiUserId: string;
    const { data: aiProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', 'AI')
      .maybeSingle();

    if (!aiProfile) {
      // Create AI user in auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: 'ai@imageboard.local',
        email_confirm: true,
        user_metadata: { username: 'AI' }
      });

      if (authError) {
        console.error('Error creating AI user:', authError);
        throw authError;
      }

      aiUserId = authData.user.id;

      // Update profile with special username color
      await supabaseAdmin
        .from('profiles')
        .update({ username_color: '#FF1493' })
        .eq('id', aiUserId);
    } else {
      aiUserId = aiProfile.id;
    }

    // Post AI reply
    const { data: post, error: postError } = await supabaseAdmin
      .from('posts')
      .insert({
        thread_id: threadId,
        user_id: aiUserId,
        content: aiContent,
        reply_to: replyToId
      })
      .select()
      .single();

    if (postError) {
      console.error('Error creating post:', postError);
      throw postError;
    }

    return new Response(
      JSON.stringify({ success: true, post }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-reply function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
