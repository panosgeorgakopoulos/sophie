export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 min-h-screen font-sans">
      <main className="flex flex-col items-center justify-center p-8 text-center max-w-2xl">
        <h1 className="text-4xl font-bold text-slate-800 mb-4">
          French Institute (Test Page)
        </h1>
        <p className="text-lg text-slate-600 mb-8">
          The chatbot widget is installed on this page. Look in the bottom right corner of your screen for the chat bubble icon to test the integration.
        </p>
      </main>
    </div>
  );
}
