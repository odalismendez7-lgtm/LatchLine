# AI behavior requirements (founder direction, received 2026-11-23)

Status: DIRECTION, NOT BUILT. This is the founder's statement of where the assistant must head. Nothing below is claimed as implemented; the current engine is deterministic and tested only with a mock model (KI-46). Scheduling, technician routing, follow-ups and proactive operations do not exist yet. Stored verbatim below.

---

ADVANCED AI INTELLIGENCE AND OPERATIONAL BEHAVIOR

LATCHLINE must be designed toward a genuinely intelligent, action-capable customer operations assistant. Do not optimize for simplistic chatbot behavior, rigid scripts or repetitive conversation patterns.

1. Intent recognition and contextual reasoning

The assistant must identify the customer’s underlying intent, not merely respond to individual messages in isolation.

It should be able to:

* Understand indirect requests.
* Recognize urgency.
* Understand context across multiple messages.
* Handle incomplete, contradictory or corrected information.
* Recognize when a customer has already answered a question.
* Determine which information is necessary and which is optional.
* Avoid unnecessary questioning.
* Recognize when clarification is genuinely required.

2. Next-action intelligence

The assistant should continuously determine the most appropriate next step based on conversation context, business knowledge, permissions, safety requirements and actual system state.

Potential actions include:

* Answering a question.
* Asking for missing information.
* Creating or updating a lead.
* Checking availability.
* Scheduling an appointment.
* Sending an authorized worker notification.
* Requesting a human handoff.
* Sending a follow-up.
* Escalating an emergency.
* Recovering from an unsuccessful operation.

It should not mechanically follow the same conversation flow for every customer.

3. Conversation quality

Prioritize natural, efficient and useful conversations.

* Avoid repetitive phrases.
* Avoid repeated greetings.
* Avoid unnecessary confirmations.
* Avoid repeatedly asking for information already provided.
* Avoid overwhelming customers with long explanations.
* Adapt responses to the situation.
* Maintain context without unnecessarily restating everything.
* Use clear language without sounding robotic.
* Recognize frustration and respond appropriately.
* Never pretend to understand when uncertain.

4. Action verification

Every external action must have a clearly tracked state.

Distinguish between:

* Action requested.
* Action being processed.
* Action successfully completed.
* Action failed.
* Action outcome unknown.
* Action awaiting human approval or confirmation.

Verify actual outcomes where possible before communicating success.

Never claim an appointment was booked, a message was sent, a technician was contacted or a change was made unless the system has sufficient evidence.

5. Intelligent recovery

Design the AI and backend integration to handle:

* Network interruptions.
* Timeouts.
* Duplicate requests.
* Partial failures.
* Delayed provider responses.
* Failed SMS delivery.
* Scheduling conflicts.
* Database failures.
* Provider outages.

The AI must avoid repeating actions that may already have succeeded.

Use idempotency, action-state tracking, appropriate retries and recovery mechanisms where applicable.

When the outcome is uncertain, verify before attempting the action again.

6. Smart technician coordination

Build toward intelligent routing based on verified business configuration and operational data.

Future routing considerations:

* Technician availability.
* Service area.
* Service type and qualifications.
* Workload.
* Business priorities.
* Appointment schedules.
* Emergency routing rules.

Do not assign technicians based on invented availability, qualifications or information.

7. Proactive operations

Design toward an AI that can recognize when an inquiry or job needs further attention.

Future capabilities:

* Pending appointment confirmation monitoring.
* Technician response monitoring.
* Customer follow-up.
* Reminder scheduling.
* Escalation of unresolved requests.
* Detection of stalled conversations.
* Notification of operational failures.

Proactive actions must respect business permissions, configured rules, customer consent where applicable, communication limits and appropriate timing.

Do not create uncontrolled loops or excessive messages.

8. Customer communication intelligence

The assistant should adapt its communication style to the situation and customer.

* Be concise when appropriate.
* Be detailed when necessary.
* Avoid robotic templates.
* Avoid repetitive wording.
* Maintain a professional and helpful tone.
* Clearly explain what happens next.
* Communicate uncertainty honestly.
* Avoid unnecessary technical terminology.
* Never misrepresent the business or its capabilities.

9. Safety and authority boundaries

The AI must operate within verified business knowledge and authorized actions.

It must not:

* Invent business policies.
* Invent prices.
* Invent appointment availability.
* Invent technician locations.
* Invent qualifications.
* Invent completed actions.
* Make unauthorized commitments.
* Claim a human has responded when nobody has.
* Promise arrival times without verified information.

Dangerous plumbing situations must receive appropriate safety guidance and escalation behavior, not ordinary lead-capture responses alone.

10. AI evaluation standard

Do not evaluate the AI only by the number of passing software tests.

Eventually evaluate:

* Conversation quality.
* Repetition.
* Context retention.
* Correct intent recognition.
* Action accuracy.
* Action failure recovery.
* Safety behavior.
* Tenant isolation.
* Hallucinations.
* Scheduling accuracy.
* Customer satisfaction.
* Response efficiency.

Create reproducible conversation evaluations and regression scenarios.

The objective is to build an assistant that can reliably handle real customer operations, not merely produce convincing text.

Do not claim superior intelligence, reliability or performance without evidence from appropriate evaluations.