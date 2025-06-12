import ollama


with open('transcription.txt', 'r', encoding='utf-8') as file:
    extracted_text = file.read().strip()

prompt = ''
stream = ollama.chat(
    model='llama3.2',
    messages=[{'role': 'user', 'content': extracted_text }],
    stream=True 
)
response = ''
for chunk in stream:
    # response += chunk['message']['content']
    print(chunk['message']['content'], flush=True)




