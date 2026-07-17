import { useState } from 'react'

// Highlights a specific phrase inside an answer — used to call out the
// parts that only exist because Mind World injected real context.
function HL({ children }) {
  return (
    <mark style={{
      background: 'rgba(124,58,237,0.28)',
      color: '#e9d8ff',
      padding: '0 4px',
      borderRadius: '4px',
      fontStyle: 'normal'
    }}>
      {children}
    </mark>
  )
}

// Marks the clause inside the "improved" prompt that came from memory,
// rather than from what the user actually typed.
function MemClause({ children }) {
  return (
    <span style={{
      display: 'block',
      marginTop: '8px',
      paddingLeft: '10px',
      borderLeft: '2px solid #7c3aed',
      color: '#c4b5fd'
    }}>
      <span style={{
        display: 'inline-block',
        fontSize: '0.68rem',
        color: '#a78bfa',
        background: 'rgba(124,58,237,0.15)',
        borderRadius: '4px',
        padding: '1px 6px',
        marginBottom: '4px',
        letterSpacing: '0.3px'
      }}>
        🧠 PULLED FROM MEMORY
      </span>
      <br />
      {children}
    </span>
  )
}

const EXAMPLES = [
  {
    id: 'student',
    tab: '🎓 Writing a school paper',
    topic: 'Getting help with a school essay',
    basicPrompt: 'can you help me write my essay on the causes of world war 1',
    basicAnswer: "Sure! Here's a possible outline: I. Introduction with thesis II. Militarism III. The alliance system IV. Imperialism V. Nationalism VI. The assassination of Archduke Franz Ferdinand VII. Conclusion. Let me know if you'd like help expanding any section.",
    improvedPrompt: (
      <>
        Need help outlining my WWI causes essay.
        <MemClause>
          Same class as my Cold War essay last month — Ms. Patel wants MLA format, a thesis in the first paragraph, and at least 3 sources cited. Her feedback on that essay was that my paragraphs need clearer topic sentences.
        </MemClause>
        Given that, can you build an outline that fixes the topic-sentence problem this time?
      </>
    ),
    improvedAnswer: (
      <>
        Since <HL>Ms. Patel's feedback on your last essay was about weak topic sentences</HL>, here's an outline where every paragraph opens with a sentence that states its argument, not just its topic — e.g. "Militarism turned a regional dispute into a continental arms race" instead of "This paragraph is about militarism." <HL>Formatted in MLA with placeholders for your 3 required sources</HL>, matching exactly what she asked for last time.
      </>
    ),
    whyBetter: [
      'Remembers the exact feedback the teacher gave on the last essay',
      'Applies the class formatting rules (MLA, 3 sources) without being asked',
      'Fixes the specific weakness flagged before, not generic essay advice'
    ]
  },
  {
    id: 'teacher',
    tab: '📚 Planning a lesson',
    topic: 'Planning a class lesson',
    basicPrompt: 'create a lesson plan about the water cycle for 4th grade',
    basicAnswer: "Sure! Here's a basic lesson plan. Objective: Students will understand the stages of the water cycle. Materials: diagram, worksheet. Warm-up (10 min): class discussion. Direct instruction (15 min): explain evaporation, condensation, precipitation. Activity (15 min): worksheet. Wrap-up (5 min): review. Let me know if you'd like more detail on any part.",
    improvedPrompt: (
      <>
        Need a lesson plan on the water cycle for my 4th grade class.
        <MemClause>
          Same class as the volcano lesson three weeks ago — the station-rotation format worked really well with these 24 kids in mixed-ability groups, and I only have 45-minute periods.
        </MemClause>
        Can you build it the same way, sized for 45 minutes?
      </>
    ),
    improvedAnswer: (
      <>
        Since <HL>station rotation is the format that already worked with this class</HL>, here are 4 stations sized for a 45-minute period with 24 students in mixed-ability groups (6 per station, ~9 min each + transitions): Station 1 — evaporation demo with a hot plate and mirror, Station 2 — condensation in a sealed jar, Station 3 — precipitation simulator, Station 4 — labeling diagram. <HL>Timed and grouped exactly like the lesson that already worked with these kids</HL>, so there's nothing new to test.
      </>
    ),
    whyBetter: [
      'Reuses the exact format (station rotation) that already worked with this class',
      'Matches real constraints — 45-minute periods, 24 students, mixed-ability groups',
      'Ready to teach tomorrow, not a generic template to adapt'
    ]
  },
  {
    id: 'admin',
    tab: '🗂️ Writing a work email',
    topic: 'Drafting a school or office announcement',
    basicPrompt: 'write an email to parents about the upcoming field trip',
    basicAnswer: 'Dear Parents and Guardians, We are excited to announce our upcoming field trip! This will be a wonderful opportunity for students to learn outside the classroom. Please review the attached permission slip and return it by the deadline. We will need a few parent volunteers to serve as chaperones. If you have any questions, please don\'t hesitate to reach out. Thank you for your continued support. Best regards,',
    improvedPrompt: (
      <>
        Need the field trip email for parents.
        <MemClause>
          Same list as the Fall Festival email in October — sign off as "Lincoln Elementary Front Office," and keep it under 150 words this time since the PTA said the October one was too long to skim on a phone.
        </MemClause>
      </>
    ),
    improvedAnswer: (
      <>
        Since <HL>parents said the October email was too long to skim on a phone</HL>, here's a version under 150 words with the same sign-off as before: "Hi families — [trip name] is on [date]. Permission slip due [date], linked here: [link]. Chaperone spots are limited — reply to volunteer. Questions? Just reply to this email. — Lincoln Elementary Front Office." <HL>Same sign-off and tone as the Fall Festival note</HL>, just short enough to read in one glance.
      </>
    ),
    whyBetter: [
      'Remembers parent feedback about email length from last time',
      'Keeps the same sign-off and tone as previous announcements',
      'Sends as-is — no rewriting needed to match past communications'
    ]
  },
  {
    id: 'debug',
    tab: '🐛 Fixing a bug',
    topic: 'Debugging a production error',
    basicPrompt: 'my express api keeps throwing a 500 error on the stripe webhook route, can you help?',
    basicAnswer: 'A 500 error means something is failing on the server. Common causes include unhandled exceptions, missing environment variables, bad JSON parsing, or a crashed dependency. Can you share your error logs and the relevant route code so I can pinpoint the issue?',
    improvedPrompt: (
      <>
        Getting a 500 on my Express <code style={{ color: '#c4b5fd' }}>/webhook/stripe</code> route right after adding the new order handler.
        <MemClause>
          This is the same app where we fixed the JWT middleware ordering bug last week in <code>middleware/auth.js</code> — moved the auth check to run after body parsing.
        </MemClause>
        Given that fix, can you check if the new webhook route is hitting the same middleware-order problem, and give me the exact fix?
      </>
    ),
    improvedAnswer: (
      <>
        Yes — this is almost certainly the same middleware-order issue as your auth bug. <HL>Stripe's webhook signing requires the raw request body</HL>, but if <code>express.json()</code> runs globally before the webhook route — the same way your old JWT check ran too early — the body gets parsed before <code>stripe.webhooks.constructEvent()</code> can verify it, which throws and surfaces as a 500. <HL>Mount <code>express.raw()</code> on just the <code>/webhook/stripe</code> route, before the global json() middleware</HL> — the same fix pattern you used for auth ordering, just applied to body parsing instead.
      </>
    ),
    whyBetter: [
      'Remembers the exact bug (middleware ordering) fixed last week',
      'Names the real file and pattern instead of asking generic questions',
      'Gives one specific fix, not a troubleshooting checklist'
    ]
  },
  {
    id: 'write',
    tab: '✍️ Writing new code',
    topic: 'Writing a new function',
    basicPrompt: 'write a function to validate an email address in javascript',
    basicAnswer: (
      <>
        Here's a simple email validator using a regex:
        <pre style={{
          margin: '10px 0 0', padding: '10px', background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px', fontSize: '0.78rem', overflowX: 'auto', color: '#bbb'
        }}>
{`function isValidEmail(email) {
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  return re.test(email)
}`}
        </pre>
        This checks for a basic email pattern. For stricter validation, consider a library like validator.js.
      </>
    ),
    improvedPrompt: (
      <>
        Add an email validator.
        <MemClause>
          Follow the same pattern as the phone number validator we wrote last week in <code>utils/validators.js</code> — Zod schema, same error shape as the rest of that file, used by the signup form.
        </MemClause>
      </>
    ),
    improvedAnswer: (
      <>
        Since <HL>utils/validators.js already uses Zod schemas with the <code>{'{ field, message }'}</code> error shape from your phone validator</HL>, here's <code>emailSchema</code> in the same style:
        <pre style={{
          margin: '10px 0 0', padding: '10px', background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px', fontSize: '0.78rem', overflowX: 'auto', color: '#bbb'
        }}>
{`export const emailSchema = z.string().email({
  message: 'Enter a valid email address'
})`}
        </pre>
        <HL>It returns the identical error shape your signup form already expects</HL> — so <code>SignupForm.jsx</code> can call it with zero changes to its error-handling code.
      </>
    ),
    whyBetter: [
      "Matches your existing validators.js pattern (Zod, not raw regex)",
      'Keeps the error shape consistent with code you already wrote',
      'Drops in with zero changes needed anywhere else'
    ]
  },
  {
    id: 'decide',
    tab: '🏗️ Making a decision',
    topic: 'A tricky architecture decision',
    basicPrompt: 'should i use redux or react context for my app',
    basicAnswer: 'Both work. Redux is better for large apps with complex state and time-travel debugging, but adds boilerplate. Context API is built into React and simpler for smaller apps, but can cause performance issues with frequent updates. For most apps, Context or a lighter library like Zustand is a good middle ground.',
    improvedPrompt: (
      <>
        Should I use Redux or Context for the new cart feature?
        <MemClause>
          This is the same app where we picked Zustand over Redux two months ago specifically to avoid the boilerplate — <code>store.js</code> already has auth and theme state in it.
        </MemClause>
        Given that, should cart state go in the existing store or a separate one?
      </>
    ),
    improvedAnswer: (
      <>
        <HL>Since you already committed to Zustand specifically to dodge Redux boilerplate</HL>, introducing Context or Redux now would undo that decision and split state management across two systems. <HL>Put cart in a separate store (<code>useCartStore</code>) rather than adding it to the existing store.js</HL> — auth/theme and cart change for unrelated reasons and at different frequencies, and Zustand is built for multiple small stores, so you get the isolation without the tradeoff you already rejected.
      </>
    ),
    whyBetter: [
      'Remembers the Zustand decision made two months ago — no re-litigating the framework choice',
      'Answers the actual question (where cart state should live), not generic pros/cons',
      'Gives a direct recommendation tied to your codebase'
    ]
  }
]

export default function CompareDemo() {
  const [active, setActive] = useState(0)
  const ex = EXAMPLES[active]

  return (
    <div style={{
      maxWidth: '1040px', margin: '0 auto 120px',
      padding: '0 24px'
    }}>
      <div style={{
        textAlign: 'center',
        fontSize: '0.75rem', color: '#555',
        fontWeight: '600', letterSpacing: '0.8px',
        marginBottom: '16px'
      }}>
        SEE THE DIFFERENCE
      </div>

      <h2 style={{
        textAlign: 'center',
        fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)',
        fontWeight: '800',
        marginBottom: '14px',
        letterSpacing: '-0.01em'
      }}>
        Same question.{' '}
        <span style={{
          background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Completely different answer.
        </span>
      </h2>
      <p style={{
        textAlign: 'center', color: '#777', fontSize: '0.95rem',
        maxWidth: '600px', margin: '0 auto 40px', lineHeight: '1.6'
      }}>
        One prompt gets a generic, textbook reply. The other silently pulls in what you told AI last time — and gets a real answer.
        Whether you're a student, teacher, office admin, or engineer.
      </p>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '10px', justifyContent: 'center',
        flexWrap: 'wrap', marginBottom: '32px'
      }}>
        {EXAMPLES.map((e, i) => (
          <button
            key={e.id}
            onClick={() => setActive(i)}
            style={{
              padding: '10px 18px',
              borderRadius: '20px',
              border: active === i ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.1)',
              background: active === i ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)',
              color: active === i ? '#e9d8ff' : '#888',
              fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {e.tab}
          </button>
        ))}
      </div>

      <div style={{
        textAlign: 'center', color: '#555', fontSize: '0.8rem',
        marginBottom: '20px', fontWeight: '500'
      }}>
        {ex.topic}
      </div>

      {/* Comparison grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: '24px', alignItems: 'start'
      }}>
        {/* Basic column */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '16px', padding: '24px'
        }}>
          <div style={{
            display: 'inline-block', padding: '4px 12px',
            borderRadius: '14px', background: 'rgba(255,255,255,0.06)',
            color: '#888', fontSize: '0.75rem', fontWeight: '600',
            marginBottom: '16px', letterSpacing: '0.3px'
          }}>
            WITHOUT MIND WORLD
          </div>

          <div style={{ fontSize: '0.7rem', color: '#555', fontWeight: '600', marginBottom: '8px', letterSpacing: '0.4px' }}>
            PROMPT
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '10px', padding: '14px', fontSize: '0.85rem',
            color: '#aaa', lineHeight: '1.6', marginBottom: '18px'
          }}>
            {ex.basicPrompt}
          </div>

          <div style={{ fontSize: '0.7rem', color: '#555', fontWeight: '600', marginBottom: '8px', letterSpacing: '0.4px' }}>
            ANSWER
          </div>
          <div style={{
            fontSize: '0.85rem', color: '#888', lineHeight: '1.7'
          }}>
            {ex.basicAnswer}
          </div>
        </div>

        {/* Improved column */}
        <div style={{
          background: 'rgba(124,58,237,0.06)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: '16px', padding: '24px'
        }}>
          <div style={{
            display: 'inline-block', padding: '4px 12px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            color: 'white', fontSize: '0.75rem', fontWeight: '700',
            marginBottom: '16px', letterSpacing: '0.3px'
          }}>
            ⚡ WITH MIND WORLD
          </div>

          <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: '600', marginBottom: '8px', letterSpacing: '0.4px' }}>
            PROMPT (AUTO-IMPROVED)
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: '10px', padding: '14px', fontSize: '0.85rem',
            color: '#ddd', lineHeight: '1.6', marginBottom: '18px'
          }}>
            {ex.improvedPrompt}
          </div>

          <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: '600', marginBottom: '8px', letterSpacing: '0.4px' }}>
            ANSWER
          </div>
          <div style={{
            fontSize: '0.85rem', color: '#ddd', lineHeight: '1.7', marginBottom: '20px'
          }}>
            {ex.improvedAnswer}
          </div>

          <div style={{
            background: 'rgba(124,58,237,0.1)',
            border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: '10px', padding: '14px 16px'
          }}>
            <div style={{ fontSize: '0.72rem', color: '#a78bfa', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.3px' }}>
              WHY THIS ANSWER IS BETTER
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: '#c4b5fd', lineHeight: '1.7' }}>
              {ex.whyBetter.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
