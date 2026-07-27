#engine v8

#feature-id RCAstroCLIWrapper : Utilities > RC-Astro CLI Wrapper
#feature-icon RcAstro.svg
#feature-info RC-Astro command-line interface wrapper for BlurXTerminator, StarXTerminator, and NoiseXTerminator.<br/>Copyright (c) 2026 FlapAstro. PolyForm Noncommercial License 1.0.0.

// RcAstro.js
// PixInsight PJSR V8 GUI wrapper for RC-Astro CLI.
// Required Notice: Copyright (c) 2026 FlapAstro.
// Required Notice: This software is provided "AS IS", without warranty of any
// kind, including fitness for a particular purpose. Use is entirely at the
// user's sole risk and responsibility.
// Licensed under the PolyForm Noncommercial License 1.0.0.
// Compatible with RC-Astro CLI 1.0.0+; tested with CLI 1.1.0.
//
// Third-party software:
// RC-Astro CLI, BlurXTerminator, StarXTerminator, and NoiseXTerminator are
// proprietary software of RC Astro, LLC and are subject to RC Astro's separate
// license agreement. PixInsight is software of Pleiades Astrophoto S.L. and is
// subject to its separate license terms. Neither third-party product is
// included with or licensed under this script's PolyForm license.
// All product names and trademarks belong to their respective owners. This
// script is an independent wrapper and is not endorsed by either company.
//
// Features:
// - Active PixInsight view mode:
//      saves active/target view to temp XISF,
//      runs RC-Astro CLI,
//      opens processed output as a new PixInsight image window.
// - Manual file mode.
// - Tool-specific GUI visibility:
//      BXT shows only BXT parameters.
//      SXT shows only SXT parameters.
//      NXT shows only NXT parameters.
// - Explicit command-specific arguments:
//      BXT: sharpen stars, star halos, automatic/manual nonstellar PSF, sharpen nonstellar, correct-only
//      SXT: optional stars output, optional unscreened stars
//      NXT: denoise channels/frequency bands, frequency scale, iterations
// - Common options:
//      device, ML version, overlap, depth
// - Tool-specific extra args retained as fallback.
// - Live progress parsing from RC-Astro output.
// - GPU parsing/reporting.
// - Progress shown in script window only.
// - Console limited to summary.
// - Full stdout/stderr log.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

var RCASTRO_MINIMUM_VERSION = [ 1, 0, 0 ];
var RCASTRO_TESTED_VERSION = [ 1, 1, 0 ];
var RCASTRO_WRAPPER_VERSION = "1.0.0";
var rcAstroVersionCache = {};
var RCASTRO_SCRIPT_DIRECTORY =
   File.extractDrive( #__FILE__ ) + File.extractDirectory( #__FILE__ );

// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

function nowString()
{
   return (new Date()).toString();
}

function trimString( s )
{
   return String( s ).replace( /^\s+|\s+$/g, "" );
}

function isNonZeroNumberString( s )
{
   var text = trimString( s );

   if ( text.length == 0 )
      return false;

   var value = Number( text );
   if ( !isFinite( value ) )
      return true;

   return value != 0;
}

function stringArrayContains( a, value )
{
   for ( var i = 0; i < a.length; ++i )
      if ( a[i] == value )
         return true;

   return false;
}

function stringArraysOverlap( a, b )
{
   for ( var i = 0; i < a.length; ++i )
      if ( stringArrayContains( b, a[i] ) )
         return true;

   return false;
}

function appendUniqueStrings( target, values )
{
   for ( var i = 0; i < values.length; ++i )
      if ( !stringArrayContains( target, values[i] ) )
         target.push( values[i] );
}

function appendNxtDenoiseOption( args, flag, value, bands, usedBands )
{
   if ( !isNonZeroNumberString( value ) )
      return;

   if ( stringArraysOverlap( bands, usedBands ) )
      return;

   args.push( flag );
   args.push( trimString( value ) );
   appendUniqueStrings( usedBands, bands );
}

function fileExists( path )
{
   try
   {
      return File.exists( path );
   }
   catch ( e )
   {
      return false;
   }
}

function directoryExists( path )
{
   try
   {
      return File.directoryExists( path );
   }
   catch ( e )
   {
      return false;
   }
}

function removeFileIfExists( path )
{
   try
   {
      if ( fileExists( path ) )
         File.remove( path );
   }
   catch ( e )
   {
      throw new Error( "Could not remove temporary file:\n" + path + "\n\n" + e.toString() );
   }
}

function directoryOfPath( path )
{
   path = String( path );
   return File.extractDrive( path ) + File.extractDirectory( path );
}

function samePath( a, b )
{
   return String( a ).replace( /\\/g, "/" ).toLowerCase() ==
          String( b ).replace( /\\/g, "/" ).toLowerCase();
}

function fileSize( path )
{
   var f = new File;
   try
   {
      f.openForReading( path );
      return f.size;
   }
   catch ( e )
   {
      return -1;
   }
   finally
   {
      try
      {
         if ( f.isOpen )
            f.close();
      }
      catch ( ignored )
      {
      }
   }
}

function quoteForLog( s )
{
   return "\"" + String( s ).replace( /\\/g, "\\\\" ).replace( /"/g, "\\\"" ) + "\"";
}

function quoteArgsForLog( args )
{
   var s = "";

   for ( var i = 0; i < args.length; ++i )
   {
      if ( i > 0 )
         s += " ";

      s += quoteForLog( args[i] );
   }

   return s;
}

function splitCommandLine( s )
{
   var args = [];
   var current = "";
   var inQuotes = false;
   var escaped = false;

   for ( var i = 0; i < s.length; ++i )
   {
      var c = s.charAt( i );

      if ( escaped )
      {
         current += c;
         escaped = false;
         continue;
      }

      if ( c == "\\" )
      {
         var next = ( i + 1 < s.length ) ? s.charAt( i + 1 ) : "";

         if ( next == "\\" || next == "\"" )
            escaped = true;
         else
            current += c;

         continue;
      }

      if ( c == '"' )
      {
         inQuotes = !inQuotes;
         continue;
      }

      if ( !inQuotes && /\s/.test( c ) )
      {
         if ( current.length > 0 )
         {
            args.push( current );
            current = "";
         }
      }
      else
      {
         current += c;
      }
   }

   if ( inQuotes )
      throw new Error( "Unbalanced quote in extra command-line arguments:\n" + s );

   if ( escaped )
      current += "\\";

   if ( current.length > 0 )
      args.push( current );

   return args;
}

function appendSplitArgs( targetArgs, argString )
{
   argString = trimString( argString );

   if ( argString.length == 0 )
      return;

   var extra = splitCommandLine( argString );

   for ( var i = 0; i < extra.length; ++i )
      targetArgs.push( extra[i] );
}

function sanitizeIdentifier( s )
{
   s = String( s );
   s = s.replace( /[^A-Za-z0-9_]/g, "_" );
   s = s.replace( /^_+/, "" );

   if ( s.length == 0 )
      s = "image";

   if ( s.match( /^[0-9]/ ) )
      s = "img_" + s;

   return s;
}

function pathJoin( dir, file )
{
   dir = String( dir );

   if ( dir.length == 0 )
      return file;

   var last = dir.charAt( dir.length - 1 );

   if ( last == "/" || last == "\\" )
      return dir + file;

   return dir + "/" + file;
}

function defaultTempDirectory()
{
   return File.systemTempDirectory;
}

function defaultRCAstroExecutable()
{
   var candidates = [
      "C:/Program Files/RC-Astro/cli/rc-astro.exe",
      "C:/Program Files/RC-Astro/rc-astro.exe",
      "C:/Program Files (x86)/RC-Astro/cli/rc-astro.exe"
   ];

   for ( var i = 0; i < candidates.length; ++i )
      if ( fileExists( candidates[i] ) )
         return candidates[i];

   return candidates[0];
}

function settingsReadString( key, fallback )
{
   try
   {
      var value = Settings.read( key, DataType.String );
      if ( value != null )
         return String( value );
   }
   catch ( ignored )
   {
   }

   return fallback;
}

function settingsReadBoolean( key, fallback )
{
   try
   {
      var value = Settings.read( key, DataType.Boolean );
      if ( value != null )
         return Boolean( value );
   }
   catch ( ignored )
   {
   }

   return fallback;
}

function settingsWriteString( key, value )
{
   try
   {
      Settings.write( key, DataType.String, String( value ) );
   }
   catch ( ignored )
   {
   }
}

function settingsWriteBoolean( key, value )
{
   try
   {
      Settings.write( key, DataType.Boolean, Boolean( value ) );
   }
   catch ( ignored )
   {
   }
}

function toolSuffix( tool )
{
   if ( tool == "bxt" )
      return "_BXT";

   if ( tool == "sxt" )
      return "_SXT";

   if ( tool == "nxt" )
      return "_NXT";

   return "_" + tool;
}

function showMessage( title, text, icon )
{
   try
   {
      (new MessageBox(
         text,
         title,
         icon,
         StdButton.Ok
      )).execute();
   }
   catch ( e )
   {
   }
}

function writeConsoleInfo( title, text )
{
   console.noteln( "<end><cbr><br>* " + title );
   if ( text && String( text ).length > 0 )
      console.noteln( text );
   console.flush();
}

function writeConsoleWarning( title, text )
{
   console.warningln( "<end><cbr><br>** Warning: " + title );
   console.warningln( text );
   console.flush();
}

function showWarning( title, text )
{
   writeConsoleWarning( title, text );
   showMessage( title, text, StdIcon.Warning );
}

function writeConsoleError( title, text )
{
   console.criticalln( "<end><cbr><br>*** Error: " + title );
   console.criticalln( text );
   console.flush();
}

function showError( title, text )
{
   writeConsoleError( title, text );
   showMessage( title, text, StdIcon.Error );
}

// -----------------------------------------------------------------------------
// RC-Astro output parsing
// -----------------------------------------------------------------------------

function extractLatestRCAstroProgress( text )
{
   if ( !text )
      return null;

   var s = String( text );

   // RC-Astro progress often uses carriage returns.
   s = s.replace( /\r/g, "\n" );
   s = s.replace( /Processing \[/g, "\nProcessing [" );

   var lines = s.split( "\n" );
   var latest = null;

   for ( var i = 0; i < lines.length; ++i )
   {
      var line = lines[i];

      var m = line.match(
         /Processing\s+\[([=\s]+)\]\s+(\d+)%\s+([0-9.]+)\s+MP\/s\s+ETA\s+([0-9:]+)/
      );

      if ( m )
      {
         latest = {
            raw: line,
            bar: m[1],
            percent: parseInt( m[2], 10 ),
            speed: m[3],
            eta: m[4]
         };
      }
   }

   return latest;
}

function extractRCAstroGpu( text )
{
   if ( !text )
      return "";

   var s = String( text );
   var gpu = s.match( /Using gpu:\s*([^\r\n]+)/ );

   if ( gpu )
      return trimString( gpu[1] );

   return "";
}

function extractRCAstroToolInfo( text )
{
   if ( !text )
      return "";

   var s = String( text );

   var ai = s.match( /(BlurXTerminator|StarXTerminator|NoiseXTerminator)[^\r\n]*/ );
   if ( ai )
      return trimString( ai[0] );

   return "";
}

function makeTextProgressBar( percent, width )
{
   if ( percent < 0 )
      percent = 0;

   if ( percent > 100 )
      percent = 100;

   var filled = Math.round( width * percent / 100 );
   var s = "[";

   for ( var i = 0; i < width; ++i )
      s += ( i < filled ) ? "#" : "-";

   s += "]";
   return s;
}

function makeMovingBar( frame, width )
{
   var pos = frame % width;
   var s = "[";

   for ( var j = 0; j < width; ++j )
   {
      if ( j == pos )
         s += "#";
      else if ( j == pos - 1 || j == pos + 1 )
         s += "=";
      else
         s += "-";
   }

   s += "]";
   return s;
}

function tailString( s, maxLength )
{
   s = String( s );

   if ( s.length <= maxLength )
      return s;

   return s.substring( s.length - maxLength );
}

function readProcessText( process, streamName )
{
   var data = streamName == "stdout" ? process.stdout : process.stderr;
   return data.length > 0 ? data.utf8ToString() : "";
}

function externalProcessIsRunning( process )
{
   return process.isRunning;
}

function stopExternalProcess( process )
{
   if ( process && process.isRunning )
      process.terminate();
}

function versionString( version )
{
   return version[0] + "." + version[1] + "." + version[2];
}

function compareVersions( a, b )
{
   for ( var i = 0; i < 3; ++i )
   {
      if ( a[i] < b[i] )
         return -1;
      if ( a[i] > b[i] )
         return 1;
   }

   return 0;
}

function parseRCAstroVersion( text )
{
   text = String( text );

   try
   {
      var document = JSON.parse( trimString( text ) );
      if ( document && document.cliVersion )
         text = String( document.cliVersion );
   }
   catch ( ignored )
   {
      var jsonMatch = text.match(
         /"cliVersion"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^"]*)?)"/i
      );
      if ( jsonMatch )
         text = jsonMatch[1];
   }

   var match = text.match( /(?:^|[^0-9])v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:[^0-9]|$)/i );
   if ( !match )
      return null;

   return [ Number( match[1] ), Number( match[2] ), Number( match[3] ) ];
}

function verifyRCAstroCompatibility( executable )
{
   executable = trimString( executable );

   if ( executable.length == 0 )
      throw new Error( "No RC-Astro CLI executable is configured." );

   if ( !fileExists( executable ) || directoryExists( executable ) )
      throw new Error( "RC-Astro CLI executable was not found:\n" + executable );

   var cacheKey = executable.replace( /\\/g, "/" ).toLowerCase();
   if ( rcAstroVersionCache[cacheKey] )
      return rcAstroVersionCache[cacheKey];

   var process = new ExternalProcess;
   process.start( executable, [ "--json" ] );

   if ( !process.waitForFinished( 10000 ) )
   {
      stopExternalProcess( process );
      throw new Error(
         "RC-Astro CLI did not respond to the version check within 10 seconds:\n" +
         executable
      );
   }

   var stdoutText = readProcessText( process, "stdout" );
   var stderrText = readProcessText( process, "stderr" );
   var combined = stdoutText + "\n" + stderrText;

   if ( process.exitCode !== 0 )
      throw new Error(
         "RC-Astro CLI version check failed with exit code " +
         process.exitCode + ".\n\n" +
         tailString( combined, 4000 )
      );

   var version = parseRCAstroVersion( combined );
   if ( version == null )
      throw new Error(
         "RC-Astro CLI is present, but its version could not be read from " +
         "the --json response.\n\n" +
         tailString( combined, 4000 )
      );

   if ( compareVersions( version, RCASTRO_MINIMUM_VERSION ) < 0 )
      throw new Error(
         "RC-Astro CLI " + versionString( version ) +
         " is too old. This script requires version " +
         versionString( RCASTRO_MINIMUM_VERSION ) + " or newer."
      );

   if ( compareVersions( version, RCASTRO_TESTED_VERSION ) > 0 )
      writeConsoleWarning(
         "Newer RC-Astro CLI detected",
         "Installed version " + versionString( version ) +
         " is newer than the version tested with this script (" +
         versionString( RCASTRO_TESTED_VERSION ) +
         "). Compatibility is not guaranteed."
      );

   rcAstroVersionCache[cacheKey] = version;
   return version;
}

function updateTextBoxIfChanged( textBox, text )
{
   if ( textBox.text != text )
      textBox.text = text;
}

function uniqueViewId( prefix )
{
   var base = sanitizeIdentifier( prefix );

   for ( var i = 1; i < 10000; ++i )
   {
      var id = base + "_" + i.toString();
      var view = View.viewById( id );

      if ( view === null || view.isNull )
         return id;
   }

   return base + "_" + (new Date()).getTime().toString();
}

// -----------------------------------------------------------------------------
// PixInsight active view helpers
// -----------------------------------------------------------------------------

function getTargetView()
{
   if ( Parameters.isViewTarget && !Parameters.targetView.isNull )
      return Parameters.targetView;

   try
   {
      var w = ImageWindow.activeWindow;

      if ( w && !w.isNull )
      {
         var v = w.currentView;

         if ( v && !v.isNull )
            return v;
      }
   }
   catch ( e2 )
   {
   }

   throw new Error( "No active PixInsight image view found." );
}

function saveViewToXISF( view, path )
{
   var tmpWindow = null;

   try
   {
      var sourceImage = view.image;

      if ( !sourceImage )
         throw new Error( "The selected view has no image." );

      var channelCount = sourceImage.numberOfChannels;
      var sourceWindow = view.window;

      tmpWindow = new ImageWindow(
         sourceImage.width,
         sourceImage.height,
         channelCount,
         sourceWindow.bitsPerSample,
         sourceWindow.isFloatSample,
         sourceImage.isColor,
         uniqueViewId( "RcAstro_SourceCopy" )
      );

      if ( tmpWindow.isNull )
         throw new Error( "Could not create a temporary copy of the active image window." );

      tmpWindow.mainView.beginProcess();
      tmpWindow.mainView.image.assign( sourceImage );
      tmpWindow.mainView.endProcess();

      tmpWindow.saveAs( path, false, false, false, false );

      try
      {
         tmpWindow.forceClose();
      }
      catch ( ignoredClose )
      {
      }

      return;
   }
   catch ( e )
   {
      try
      {
         if ( tmpWindow && !tmpWindow.isNull )
            tmpWindow.forceClose();
      }
      catch ( ignored )
      {
      }

      throw new Error(
         "Could not save active view to temporary XISF.\n\n" +
         "The script avoided saving the original image window directly.\n\n" +
         "Copy/save error:\n" + e.toString()
      );
   }
}

function cloneViewSTF( view )
{
   if ( !view || view.isNull )
      throw new Error( "Cannot read the display STF from a null view." );

   var sourceSTF = view.stf;
   if ( !sourceSTF || sourceSTF.length < 4 )
      throw new Error( "The input view has no valid screen transfer function." );

   var copy = new Array;
   for ( var row = 0; row < 4; ++row )
   {
      if ( !sourceSTF[row] || sourceSTF[row].length < 5 )
         throw new Error( "The input view has an incomplete screen transfer function." );

      copy[row] = new Array;
      for ( var column = 0; column < 5; ++column )
      {
         var value = Number( sourceSTF[row][column] );
         if ( !isFinite( value ) )
            throw new Error( "The input view has a non-finite STF parameter." );
         copy[row][column] = value;
      }
   }

   return copy;
}

function isIdentityViewSTF( stf )
{
   var identity = [ 0.5, 0, 1, 0, 1 ]; // View.stf order: m, c0, c1, r0, r1
   var tolerance = 1.0e-12;

   for ( var row = 0; row < 4; ++row )
      for ( var column = 0; column < 5; ++column )
         if ( Math.abs( stf[row][column] - identity[column] ) > tolerance )
            return false;

   return true;
}

function captureViewDisplayState( view )
{
   var stf = cloneViewSTF( view );
   var hasScreenStretch = !isIdentityViewSTF( stf );

   return {
      stf: stf,
      hasScreenStretch: hasScreenStretch,
      description: hasScreenStretch
         ? "input STF copied (nonidentity STF; typical linear workflow)"
         : "identity STF preserved (typical nonlinear workflow or unstretched linear data)"
   };
}

function normalizedPathForComparison( path )
{
   return trimString( path ).replace( /\\/g, "/" ).toLowerCase();
}

function findOpenViewForFile( filePath )
{
   var wanted = normalizedPathForComparison( filePath );
   if ( wanted.length == 0 )
      return null;

   try
   {
      var windows = ImageWindow.windows;
      for ( var i = 0; i < windows.length; ++i )
      {
         var window = windows[i];
         if ( window && !window.isNull &&
              normalizedPathForComparison( window.filePath ) == wanted )
         {
            var view = window.currentView;
            if ( view && !view.isNull )
               return view;

            view = window.mainView;
            if ( view && !view.isNull )
               return view;
         }
      }
   }
   catch ( ignored )
   {
   }

   return null;
}

function applyViewDisplayState( window, displayState )
{
   if ( !displayState )
      return "not copied (the manual input file was not open in PixInsight)";

   if ( !window || window.isNull || !window.mainView || window.mainView.isNull )
      throw new Error( "Cannot apply the input STF to a null output view." );

   window.mainView.stf = displayState.stf;
   return displayState.description;
}

function openOutputImage( outputFile, displayState )
{
   var windows = ImageWindow.open( outputFile );

   if ( !windows || windows.length == 0 )
      throw new Error( "RC-Astro output file exists, but PixInsight could not open it:\n" + outputFile );

   var displayDescription;
   try
   {
      displayDescription = applyViewDisplayState( windows[0], displayState );
   }
   catch ( displayError )
   {
      displayDescription = "not copied: " + displayError.toString();
      writeConsoleWarning(
         "Output STF transfer failed",
         "The result image was opened without copying the input display STF.\n" +
         displayError.toString()
      );
   }

   try
   {
      windows[0].show();
      windows[0].bringToFront();
   }
   catch ( ignored )
   {
   }

   return {
      window: windows[0],
      displayDescription: displayDescription
   };
}

function insertBeforeExtension( filePath, suffix )
{
   return File.appendToName( filePath, suffix );
}

function sxtStarsOutputCandidates( outputFile )
{
   var dir = directoryOfPath( outputFile );
   var name = File.extractName( outputFile );
   var ext = File.extractExtension( outputFile );
   var candidates = new Array;

   candidates.push( insertBeforeExtension( outputFile, "-stars" ) );
   candidates.push( insertBeforeExtension( outputFile, "_stars" ) );
   candidates.push( insertBeforeExtension( outputFile, "-sxt-stars" ) );
   candidates.push( insertBeforeExtension( outputFile, "_sxt_stars" ) );

   if ( /-starless$/i.test( name ) )
      candidates.push( pathJoin( dir, name.replace( /-starless$/i, "-stars" ) + ext ) );

   if ( /_starless$/i.test( name ) )
      candidates.push( pathJoin( dir, name.replace( /_starless$/i, "_stars" ) + ext ) );

   return candidates;
}

function findSxtStarsOutputFile( outputFile )
{
   var candidates = sxtStarsOutputCandidates( outputFile );

   for ( var i = 0; i < candidates.length; ++i )
      if ( fileExists( candidates[i] ) )
         return candidates[i];

   return "";
}

// -----------------------------------------------------------------------------
// File dialogs
// -----------------------------------------------------------------------------

function selectOpenFile( caption, filters )
{
   try
   {
      var d = new OpenFileDialog;
      d.caption = caption;
      d.multipleSelections = false;
      d.filters = filters;

      if ( d.execute() )
         return d.fileName;
   }
   catch ( e )
   {
      showWarning(
         "File dialog unavailable",
         "Could not open the file picker.\n\n" +
         "Please type the path manually.\n\n" +
         e.toString()
      );
   }

   return "";
}

function selectSaveFile( caption, filters )
{
   try
   {
      var d = new SaveFileDialog;
      d.caption = caption;
      d.filters = filters;

      if ( d.execute() )
         return d.fileName;
   }
   catch ( e )
   {
      showWarning(
         "Save dialog unavailable",
         "Could not open the save-file picker.\n\n" +
         "Please type the path manually.\n\n" +
         e.toString()
      );
   }

   return "";
}

// -----------------------------------------------------------------------------
// Command-specific argument builder
// -----------------------------------------------------------------------------
//
// This is the single place to adapt RC-Astro CLI option names.
//
// Confirm locally with:
//   rc-astro bxt
//   rc-astro sxt
//   rc-astro nxt

function buildRCAstroArgs(
   tool,
   inputFile,
   outputFile,
   overwrite,

   // BXT
   bxtSharpenStars,
   bxtAdjustStarHalos,
   bxtAutoNonstellarPsf,
   bxtNonstellarDiameter,
   bxtSharpenNonstellar,
   bxtCorrectOnly,

   // SXT
   sxtStars,
   sxtUnscreen,

   // NXT
   nxtDenoise,
   nxtDenoiseIntensity,
   nxtDenoiseColor,
   nxtDenoiseHighFreq,
   nxtDenoiseLowFreq,
   nxtDenoiseIntensityHighFreq,
   nxtDenoiseIntensityLowFreq,
   nxtDenoiseColorHighFreq,
   nxtDenoiseColorLowFreq,
   nxtFrequencyScale,
   nxtIterations,

   // Common
   device,
   mlVersion,
   overlap,
   outputDepth,
   debugOutput,

   // Extra/fallback
   bxtExtraArgs,
   sxtExtraArgs,
   nxtExtraArgs,
   commonExtraArgs
)
{
   var args = [];

   args.push( tool );
   args.push( inputFile );

   if ( tool == "bxt" )
   {
      if ( trimString( bxtSharpenStars ).length > 0 )
      {
         args.push( "--sharpen-stars" );
         args.push( trimString( bxtSharpenStars ) );
      }

      if ( trimString( bxtAdjustStarHalos ).length > 0 )
      {
         args.push( "--adjust-star-halos" );
         args.push( trimString( bxtAdjustStarHalos ) );
      }

      if ( bxtAutoNonstellarPsf )
      {
         args.push( "--auto-nonstellar-psf" );
      }
      else
      {
         args.push( "--no-auto-nonstellar-psf" );

         if ( trimString( bxtNonstellarDiameter ).length > 0 )
         {
            args.push( "--nonstellar-diameter" );
            args.push( trimString( bxtNonstellarDiameter ) );
         }
      }

      if ( trimString( bxtSharpenNonstellar ).length > 0 )
      {
         args.push( "--sharpen-nonstellar" );
         args.push( trimString( bxtSharpenNonstellar ) );
      }

      if ( bxtCorrectOnly )
         args.push( "--correct-only" );

      appendSplitArgs( args, bxtExtraArgs );
   }
   else if ( tool == "sxt" )
   {
      if ( sxtStars )
         args.push( "--stars" );

      if ( sxtUnscreen )
         args.push( "--unscreen-stars" );

      appendSplitArgs( args, sxtExtraArgs );
   }
   else if ( tool == "nxt" )
   {
      var usedBands = [];
      var ihf = "intensity-high";
      var ilf = "intensity-low";
      var chf = "color-high";
      var clf = "color-low";

      appendNxtDenoiseOption( args, "--denoise", nxtDenoise, [ ihf, ilf, chf, clf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-intensity", nxtDenoiseIntensity, [ ihf, ilf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-color", nxtDenoiseColor, [ chf, clf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-high-freq", nxtDenoiseHighFreq, [ ihf, chf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-low-freq", nxtDenoiseLowFreq, [ ilf, clf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-intensity-high-freq", nxtDenoiseIntensityHighFreq, [ ihf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-intensity-low-freq", nxtDenoiseIntensityLowFreq, [ ilf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-color-high-freq", nxtDenoiseColorHighFreq, [ chf ], usedBands );
      appendNxtDenoiseOption( args, "--denoise-color-low-freq", nxtDenoiseColorLowFreq, [ clf ], usedBands );

      if ( trimString( nxtFrequencyScale ).length > 0 )
      {
         args.push( "--frequency-scale" );
         args.push( trimString( nxtFrequencyScale ) );
      }

      if ( trimString( nxtIterations ).length > 0 )
      {
         args.push( "--iterations" );
         args.push( trimString( nxtIterations ) );
      }

      appendSplitArgs( args, nxtExtraArgs );
   }
   else
   {
      throw new Error( "Unknown RC-Astro tool: " + tool );
   }

   args.push( "--output" );
   args.push( outputFile );

   if ( overwrite )
      args.push( "--overwrite" );

   if ( trimString( device ).length > 0 )
   {
      args.push( "--device" );
      args.push( trimString( device ) );
   }

   if ( trimString( mlVersion ).length > 0 )
   {
      args.push( "--ml-version" );
      args.push( trimString( mlVersion ) );
   }

   if ( trimString( overlap ).length > 0 )
   {
      args.push( "--overlap" );
      args.push( trimString( overlap ) );
   }

   if ( trimString( outputDepth ).length > 0 )
   {
      args.push( "--depth" );
      args.push( trimString( outputDepth ) );
   }

   if ( debugOutput )
      args.push( "--debug" );

   appendSplitArgs( args, commonExtraArgs );

   return args;
}

function validateOptionalNumber( label, value, minValue, maxValue )
{
   value = trimString( value );

   if ( value.length == 0 )
      return;

   var n = Number( value );

   if ( !isFinite( n ) )
      throw new Error( label + " must be a finite numeric value." );

   if ( minValue != null && n < minValue )
      throw new Error( label + " must be >= " + minValue + "." );

   if ( maxValue != null && n > maxValue )
      throw new Error( label + " must be <= " + maxValue + "." );
}

function validateOptionalChoice( label, value, choices )
{
   value = trimString( value );

   if ( value.length == 0 )
      return;

   for ( var i = 0; i < choices.length; ++i )
      if ( value == choices[i] )
         return;

   throw new Error( label + " must be one of: " + choices.join( ", " ) + "." );
}

function validateExtraArguments( label, value )
{
   var args = splitCommandLine( trimString( value ) );
   var prohibited = [
      "--output",
      "--overwrite",
      "--no-overwrite",
      "--auto-nonstellar-radius",
      "--no-auto-nonstellar-radius",
      "--nonstellar-radius"
   ];

   for ( var i = 0; i < args.length; ++i )
      if ( stringArrayContains( prohibited, args[i].toLowerCase() ) )
         throw new Error(
            label + " contains an obsolete or script-managed option: " +
            args[i] + "."
         );
}

function validateOutputPaths( inputFile, outputFile, logFile )
{
   if ( samePath( inputFile, outputFile ) )
      throw new Error( "Input and output paths must be different:\n" + inputFile );

   if ( samePath( inputFile, logFile ) )
      throw new Error( "Input and log paths must be different:\n" + inputFile );

   if ( samePath( outputFile, logFile ) )
      throw new Error( "Output and log paths must be different:\n" + outputFile );

   if ( directoryExists( inputFile ) )
      throw new Error( "The input path points to a directory, not an image file:\n" + inputFile );

   if ( directoryExists( outputFile ) )
      throw new Error( "The output path points to a directory, not an image file:\n" + outputFile );

   if ( directoryExists( logFile ) )
      throw new Error( "The log path points to a directory, not a file:\n" + logFile );

   var outputDir = directoryOfPath( outputFile );
   var logDir = directoryOfPath( logFile );

   if ( outputDir.length > 0 && !directoryExists( outputDir ) )
      throw new Error( "Output directory does not exist:\n" + outputDir );

   if ( logDir.length > 0 && !directoryExists( logDir ) )
      throw new Error( "Log directory does not exist:\n" + logDir );
}

// -----------------------------------------------------------------------------
// GUI dialog
// -----------------------------------------------------------------------------

var RunRCAstroDialog = class extends Dialog
{
   constructor()
   {
   super();

   var self = this;

   this.windowTitle = "RC-Astro CLI Wrapper";
   this.processRunning = false;
   this.cancelRequested = false;

   var headerLabel = new Label( this );
   headerLabel.frameStyle = FrameStyle.Box;
   headerLabel.margin = 4;
   headerLabel.wordWrapping = true;
   headerLabel.useRichText = true;
   headerLabel.backgroundColor = 0xffffd700;
   headerLabel.textColor = 0xff4b0082;
   headerLabel.text =
      "<p><b>RC-Astro CLI Wrapper - Version: " +
      RCASTRO_WRAPPER_VERSION +
      "</b></p>";

   var introductionLabel = new Label( this );
   introductionLabel.frameStyle = FrameStyle.Box;
   introductionLabel.margin = 4;
   introductionLabel.useRichText = true;
   introductionLabel.wordWrapping = true;
   introductionLabel.text =
      "<p>A graphical PixInsight interface for BlurXTerminator, " +
      "StarXTerminator, and NoiseXTerminator through the stand-alone " +
      "RC-Astro CLI.<br/>" +
      "Copyright &copy; FlapAstro 2026<br/>" +
      "PolyForm Noncommercial License 1.0.0.<br/>" +
      "<i>RC-Astro and PixInsight remain separately owned and licensed by " +
      "RC Astro, LLC and Pleiades Astrophoto S.L., respectively.</i></p>";

   var settingsPrefix = "RcAstroGUI/";
   var defaultTempDir = defaultTempDirectory();
   var defaultExe = defaultRCAstroExecutable();
   var defaultInput = pathJoin( defaultTempDir, "in.xisf" );
   var defaultOutput = pathJoin( defaultTempDir, "in_bxt.xisf" );
   var defaultLog = pathJoin( defaultTempDir, "rcastro_cli.log" );

   function makeLabel( parent, text )
   {
      var label = new Label( parent );
      label.text = text;
      label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      label.minWidth = 135;
      return label;
   }

   function makePathRow( parent, labelText, edit, buttonText, onClick )
   {
      var label = makeLabel( parent, labelText );

      edit.minWidth = 560;

      var button = new PushButton( parent );
      button.text = buttonText;
      button.onClick = onClick;

      var sizer = new HorizontalSizer;
      sizer.spacing = 6;
      sizer.add( label );
      sizer.add( edit, 100 );
      sizer.add( button );

      return sizer;
   }

   function makeEditRow( parent, labelText, edit )
   {
      var label = makeLabel( parent, labelText );

      edit.minWidth = 560;

      var sizer = new HorizontalSizer;
      sizer.spacing = 6;
      sizer.add( label );
      sizer.add( edit, 100 );

      return sizer;
   }

   function makeSection( parent, title, rows )
   {
      var section = new VerticalSizer;
      section.margin = 6;
      section.spacing = 4;

      for ( var i = 0; i < rows.length; ++i )
         section.add( rows[i] );

      return section;
   }

   function showPreferencesDialog()
   {
      var d = new Dialog;
      d.windowTitle = "RC-Astro Preferences";

      function prefLabel( text )
      {
         var label = new Label( d );
         label.text = text;
         label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
         label.minWidth = 135;
         return label;
      }

      function prefPathRow( labelText, edit, buttonText, onClick )
      {
         edit.minWidth = 560;

         var button = new PushButton( d );
         button.text = buttonText;
         button.onClick = onClick;

         var row = new HorizontalSizer;
         row.spacing = 6;
         row.add( prefLabel( labelText ) );
         row.add( edit, 100 );
         row.add( button );
         return row;
      }

      function prefEditRow( labelText, edit )
      {
         edit.minWidth = 560;

         var row = new HorizontalSizer;
         row.spacing = 6;
         row.add( prefLabel( labelText ) );
         row.add( edit, 100 );
         return row;
      }

      function prefSection( title, rows )
      {
         var section = new VerticalSizer;
         section.margin = 6;
         section.spacing = 4;

         var titleLabel = new Label( d );
         titleLabel.text = title;
         titleLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;
         section.add( titleLabel );

         for ( var i = 0; i < rows.length; ++i )
            section.add( rows[i] );

         return section;
      }

      var exeEdit = new Edit( d );
      exeEdit.text = self.exeEdit.text;
      exeEdit.toolTip = "<p>Path to the RC-Astro command-line executable.</p>";

      var tempDirEdit = new Edit( d );
      tempDirEdit.text = self.tempDirEdit.text;
      tempDirEdit.toolTip = "<p>Folder used for temporary active-view XISF files, outputs, and logs.</p>";

      var logEdit = new Edit( d );
      logEdit.text = self.logEdit.text;
      logEdit.toolTip = "<p>Default log file path for manual-file mode.</p>";

      var openResultCheck = new CheckBox( d );
      openResultCheck.text = "Open result in PixInsight";
      openResultCheck.checked = self.openResultCheck.checked;
      openResultCheck.toolTip =
         "<p>Open the generated output image after a successful run. " +
         "The input view's display STF is copied when available.</p>";

      var keepTempCheck = new CheckBox( d );
      keepTempCheck.text = "Keep temporary input file";
      keepTempCheck.checked = self.keepTempCheck.checked;
      keepTempCheck.toolTip = "<p>Keep the temporary XISF created from the active PixInsight view.</p>";

      var overwriteCheck = new CheckBox( d );
      overwriteCheck.text = "Overwrite output file";
      overwriteCheck.checked = self.overwriteCheck.checked;
      overwriteCheck.toolTip = "<p>Pass --overwrite. Existing output files will be replaced.</p>";

      var debugCheck = new CheckBox( d );
      debugCheck.text = "Debug output";
      debugCheck.checked = self.debugCheck.checked;
      debugCheck.toolTip = "<p>Pass --debug to enable RC-Astro debug output.</p>";

      var deviceEdit = new Edit( d );
      deviceEdit.text = self.deviceEdit.text;
      deviceEdit.toolTip = "<p>Compute device. Values: auto, cpu, gpu, gpuN. Leave blank for RC-Astro default.</p>";

      var mlVersionEdit = new Edit( d );
      mlVersionEdit.text = self.mlVersionEdit.text;
      mlVersionEdit.toolTip = "<p>Model version. 0 means latest. Leave blank for the RC-Astro default. The current NoiseXTerminator ML3 model is faster on Windows and Linux while producing identical results; the macOS ML3 model is unchanged.</p>";

      var overlapEdit = new Edit( d );
      overlapEdit.text = self.overlapEdit.text;
      overlapEdit.toolTip = "<p>Tile overlap fraction. Range: 0.0 to 0.5. Leave blank for RC-Astro default.</p>";

      var outputDepthEdit = new Edit( d );
      outputDepthEdit.text = self.outputDepthEdit.text;
      outputDepthEdit.toolTip = "<p>Output bit depth. Values: 8U, 16U, 32F, 64F. Leave blank to match input.</p>";

      var commonExtraArgsEdit = new Edit( d );
      commonExtraArgsEdit.text = self.commonExtraArgsEdit.text;
      commonExtraArgsEdit.toolTip = "<p>Additional RC-Astro arguments appended after common options.</p>";

      var exeRow = prefPathRow(
         "rc-astro:",
         exeEdit,
         "Browse",
         function()
         {
            var p = selectOpenFile(
               "Select rc-astro executable",
               [
                  [ "Executable files", "*.exe" ],
                  [ "All files", "*" ]
               ]
            );

            if ( p.length > 0 )
               exeEdit.text = p;
         }
      );

      var tempDirRow = prefEditRow( "Temp dir:", tempDirEdit );

      var logRow = prefPathRow(
         "Default log:",
         logEdit,
         "Browse",
         function()
         {
            var p = selectSaveFile(
               "Select default log file",
               [
                  [ "Log files", "*.log *.txt" ],
                  [ "All files", "*" ]
               ]
            );

            if ( p.length > 0 )
               logEdit.text = p;
         }
      );

      var prefCheckRow = new HorizontalSizer;
      prefCheckRow.spacing = 6;
      prefCheckRow.addSpacing( 141 );
      prefCheckRow.add( openResultCheck );
      prefCheckRow.addSpacing( 20 );
      prefCheckRow.add( keepTempCheck );
      prefCheckRow.addSpacing( 20 );
      prefCheckRow.add( overwriteCheck );
      prefCheckRow.addSpacing( 20 );
      prefCheckRow.add( debugCheck );
      prefCheckRow.addStretch();

      var common1Row = new HorizontalSizer;
      common1Row.spacing = 6;
      common1Row.add( prefLabel( "Device:" ) );
      common1Row.add( deviceEdit );
      common1Row.add( prefLabel( "ML version:" ) );
      common1Row.add( mlVersionEdit );
      common1Row.addStretch();

      var common2Row = new HorizontalSizer;
      common2Row.spacing = 6;
      common2Row.add( prefLabel( "Overlap:" ) );
      common2Row.add( overlapEdit );
      common2Row.add( prefLabel( "Depth:" ) );
      common2Row.add( outputDepthEdit );
      common2Row.addStretch();

      var commonExtraRow = prefEditRow( "Common args:", commonExtraArgsEdit );

      var saveButton = new PushButton( d );
      saveButton.text = "Save";

      var cancelButton = new PushButton( d );
      cancelButton.text = "Cancel";

      saveButton.onClick = function()
      {
         try
         {
            validateOptionalNumber( "Overlap", overlapEdit.text, 0, 0.5 );
            validateOptionalChoice( "Depth", outputDepthEdit.text, [ "8U", "16U", "32F", "64F" ] );

            var tempDir = trimString( tempDirEdit.text );
            var logFile = trimString( logEdit.text );
            var selectedExecutable = trimString( exeEdit.text );
            var selectedCliVersion =
               verifyRCAstroCompatibility( selectedExecutable );

            if ( tempDir.length == 0 )
               throw new Error( "No temporary directory specified." );

            if ( !directoryExists( tempDir ) )
               throw new Error( "Temporary directory does not exist:\n" + tempDir );

            var logDir = directoryOfPath( logFile );
            if ( logFile.length > 0 && logDir.length > 0 && !directoryExists( logDir ) )
               throw new Error( "Log directory does not exist:\n" + logDir );

            self.exeEdit.text = selectedExecutable;
            self.tempDirEdit.text = tempDirEdit.text;
            self.logEdit.text = logEdit.text;
            self.openResultCheck.checked = openResultCheck.checked;
            self.keepTempCheck.checked = keepTempCheck.checked;
            self.overwriteCheck.checked = overwriteCheck.checked;
            self.debugCheck.checked = debugCheck.checked;
            self.deviceEdit.text = deviceEdit.text;
            self.mlVersionEdit.text = mlVersionEdit.text;
            self.overlapEdit.text = overlapEdit.text;
            self.outputDepthEdit.text = outputDepthEdit.text;
            self.commonExtraArgsEdit.text = commonExtraArgsEdit.text;

            self.saveSettings();

            startupExecutable = selectedExecutable;
            startupCliVersion = selectedCliVersion;
            startupCliError = "";
            self.statusText.text =
               "READY\n\n" +
               "RC-Astro CLI version: " +
               versionString( selectedCliVersion ) + "\n" +
               "Executable: " + selectedExecutable + "\n\n" +
               "Preferences saved. The RC-Astro CLI installation is compatible.";
            writeConsoleInfo(
               "RC-Astro CLI detected",
               "Version: " + versionString( selectedCliVersion ) +
               "\nExecutable: " + selectedExecutable
            );
            d.ok();
         }
         catch ( e )
         {
            showError( "Invalid preferences", e.toString() );
         }
      };

      cancelButton.onClick = function()
      {
         d.cancel();
      };

      var buttonRow = new HorizontalSizer;
      buttonRow.spacing = 8;
      buttonRow.addStretch();
      buttonRow.add( saveButton );
      buttonRow.add( cancelButton );

      var prefsSizer = new VerticalSizer;
      d.sizer = prefsSizer;
      prefsSizer.margin = 8;
      prefsSizer.spacing = 6;
      prefsSizer.add( prefSection( "Paths", [ exeRow, tempDirRow, logRow ] ) );
      prefsSizer.add( prefSection( "Preferences", [ prefCheckRow ] ) );
      prefsSizer.add( prefSection( "Common RC-Astro arguments", [ common1Row, common2Row, commonExtraRow ] ) );
      prefsSizer.addSpacing( 6 );
      prefsSizer.add( buttonRow );
      d.adjustToContents();
      d.execute();
   }

   // --------------------------------------------------------------------------
   // General controls
   // --------------------------------------------------------------------------

   var useActiveViewCheck = new CheckBox( this );
   this.useActiveViewCheck = useActiveViewCheck;
   useActiveViewCheck.text = "Use active/target PixInsight view";
   useActiveViewCheck.checked = settingsReadBoolean( settingsPrefix + "useActiveView", true );
   useActiveViewCheck.toolTip = "<p>Use the current PixInsight target or active image view as input.</p>";

   var openResultCheck = new CheckBox( this );
   this.openResultCheck = openResultCheck;
   openResultCheck.text = "Open result in PixInsight";
   openResultCheck.checked = settingsReadBoolean( settingsPrefix + "openResult", true );
   openResultCheck.toolTip =
      "<p>Open the generated output image after a successful run. " +
      "The input view's display STF is copied when available.</p>";
   openResultCheck.visible = false;

   var keepTempCheck = new CheckBox( this );
   this.keepTempCheck = keepTempCheck;
   keepTempCheck.text = "Keep temporary input file";
   keepTempCheck.checked = settingsReadBoolean( settingsPrefix + "keepTemp", false );
   keepTempCheck.toolTip = "<p>Keep the temporary XISF created from the active PixInsight view.</p>";
   keepTempCheck.visible = false;

   var exeEdit = new Edit( this );
   this.exeEdit = exeEdit;
   exeEdit.text = settingsReadString( settingsPrefix + "exe", defaultExe );
   exeEdit.toolTip = "<p>Path to the RC-Astro command-line executable.</p>";
   exeEdit.visible = false;

   var tempDirEdit = new Edit( this );
   this.tempDirEdit = tempDirEdit;
   tempDirEdit.text = settingsReadString( settingsPrefix + "tempDir", defaultTempDir );
   tempDirEdit.toolTip = "<p>Folder used for temporary active-view XISF files, outputs, and logs.</p>";
   tempDirEdit.visible = false;

   var inputEdit = new Edit( this );
   this.inputEdit = inputEdit;
   inputEdit.text = settingsReadString( settingsPrefix + "input", defaultInput );
   inputEdit.toolTip = "<p>Input image file for manual-file mode. Active-view mode fills this automatically.</p>";

   var outputEdit = new Edit( this );
   this.outputEdit = outputEdit;
   outputEdit.text = settingsReadString( settingsPrefix + "output", defaultOutput );
   outputEdit.toolTip = "<p>Output image file or directory. Active-view mode fills this automatically.</p>";

   var logEdit = new Edit( this );
   this.logEdit = logEdit;
   logEdit.text = settingsReadString( settingsPrefix + "log", defaultLog );
   logEdit.toolTip = "<p>Full RC-Astro stdout/stderr log file.</p>";

   var toolCombo = new ComboBox( this );
   this.toolCombo = toolCombo;
   toolCombo.addItem( "bxt" );
   toolCombo.addItem( "sxt" );
   toolCombo.addItem( "nxt" );
   toolCombo.currentItem = 0;

   var savedTool = settingsReadString( settingsPrefix + "tool", "bxt" );
   if ( savedTool == "sxt" )
      toolCombo.currentItem = 1;
   else if ( savedTool == "nxt" )
      toolCombo.currentItem = 2;

   var overwriteCheck = new CheckBox( this );
   this.overwriteCheck = overwriteCheck;
   overwriteCheck.text = "Overwrite output file";
   overwriteCheck.checked = settingsReadBoolean( settingsPrefix + "overwrite", true );
   overwriteCheck.toolTip = "<p>Pass --overwrite. Existing output files will be replaced.</p>";
   overwriteCheck.visible = false;

   var debugCheck = new CheckBox( this );
   this.debugCheck = debugCheck;
   debugCheck.text = "Debug output";
   debugCheck.checked = settingsReadBoolean( settingsPrefix + "debug", false );
   debugCheck.toolTip = "<p>Pass --debug to enable RC-Astro debug output.</p>";
   debugCheck.visible = false;

   // --------------------------------------------------------------------------
   // BXT controls
   // --------------------------------------------------------------------------

   var bxtSharpenStarsEdit = new Edit( this );
   this.bxtSharpenStarsEdit = bxtSharpenStarsEdit;
   bxtSharpenStarsEdit.text = settingsReadString( settingsPrefix + "bxtSharpenStars", "0.35" );
   bxtSharpenStarsEdit.toolTip = "<p>BXT stellar sharpening amount. Range: 0.0 to 0.7.</p>";

   var bxtAdjustStarHalosEdit = new Edit( this );
   this.bxtAdjustStarHalosEdit = bxtAdjustStarHalosEdit;
   bxtAdjustStarHalosEdit.text = settingsReadString( settingsPrefix + "bxtAdjustStarHalos", "0.00" );
   bxtAdjustStarHalosEdit.toolTip = "<p>BXT star halo adjustment. Range: -0.5 to 0.5. Negative reduces halos.</p>";

   var bxtAutoNonstellarPsfCheck = new CheckBox( this );
   this.bxtAutoNonstellarPsfCheck = bxtAutoNonstellarPsfCheck;
   bxtAutoNonstellarPsfCheck.text = "BXT automatic nonstellar PSF";
   bxtAutoNonstellarPsfCheck.checked = settingsReadBoolean( settingsPrefix + "bxtAutoNonstellarPsf", true );
   bxtAutoNonstellarPsfCheck.toolTip = "<p>Use stars to estimate the PSF for nonstellar deconvolution, including optical-aberration correction. This is the default mode. Disable it for starless, lunar, or planetary images and enter the normal stellar FWHM as the manual diameter.</p>";

   var bxtNonstellarDiameterEdit = new Edit( this );
   this.bxtNonstellarDiameterEdit = bxtNonstellarDiameterEdit;
   bxtNonstellarDiameterEdit.text = settingsReadString( settingsPrefix + "bxtNonstellarDiameter", "0.0" );
   bxtNonstellarDiameterEdit.toolTip = "<p>Manual nonstellar PSF diameter (FWHM). Use this for starless, lunar, or planetary images with automatic PSF disabled. The assumed PSF is round, so optical-aberration correction is unavailable. Use 0.0 in automatic mode.</p>";

   var bxtSharpenNonstellarEdit = new Edit( this );
   this.bxtSharpenNonstellarEdit = bxtSharpenNonstellarEdit;
   bxtSharpenNonstellarEdit.text = settingsReadString( settingsPrefix + "bxtSharpenNonstellar", "0.60" );
   bxtSharpenNonstellarEdit.toolTip = "<p>BXT nonstellar sharpening amount. Range: 0.0 to 1.0.</p>";

   var bxtCorrectOnlyCheck = new CheckBox( this );
   this.bxtCorrectOnlyCheck = bxtCorrectOnlyCheck;
   bxtCorrectOnlyCheck.text = "BXT correct only";
   bxtCorrectOnlyCheck.checked = settingsReadBoolean( settingsPrefix + "bxtCorrectOnly", false );
   bxtCorrectOnlyCheck.toolTip = "<p>Correct PSF aberrations without sharpening.</p>";

   var bxtExtraArgsEdit = new Edit( this );
   this.bxtExtraArgsEdit = bxtExtraArgsEdit;
   bxtExtraArgsEdit.text = settingsReadString( settingsPrefix + "bxtExtraArgs", "" );
   bxtExtraArgsEdit.toolTip = "<p>Additional BXT-only arguments appended after explicit BXT options.</p>";

   // --------------------------------------------------------------------------
   // SXT controls
   // --------------------------------------------------------------------------

   var sxtStarsCheck = new CheckBox( this );
   this.sxtStarsCheck = sxtStarsCheck;
   sxtStarsCheck.text = "Write stars-only image";
   sxtStarsCheck.checked = settingsReadBoolean( settingsPrefix + "sxtStars", false );
   sxtStarsCheck.toolTip = "<p>Also write a stars-only image beside the starless output.</p>";

   var sxtUnscreenCheck = new CheckBox( this );
   this.sxtUnscreenCheck = sxtUnscreenCheck;
   sxtUnscreenCheck.text = "Unscreen stars";
   sxtUnscreenCheck.checked = settingsReadBoolean( settingsPrefix + "sxtUnscreen", false );
   sxtUnscreenCheck.toolTip = "<p>Unscreen the stars-only output. Requires stars-only image.</p>";

   var sxtExtraArgsEdit = new Edit( this );
   this.sxtExtraArgsEdit = sxtExtraArgsEdit;
   sxtExtraArgsEdit.text = settingsReadString( settingsPrefix + "sxtExtraArgs", "" );
   sxtExtraArgsEdit.toolTip = "<p>Additional SXT-only arguments appended after explicit SXT options.</p>";

   // --------------------------------------------------------------------------
   // NXT controls
   // --------------------------------------------------------------------------

   var nxtDenoiseEdit = new Edit( this );
   this.nxtDenoiseEdit = nxtDenoiseEdit;
   nxtDenoiseEdit.text = settingsReadString( settingsPrefix + "nxtDenoise", "0.00" );
   nxtDenoiseEdit.toolTip = "<p>NXT overall denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseIntensityEdit = new Edit( this );
   this.nxtDenoiseIntensityEdit = nxtDenoiseIntensityEdit;
   nxtDenoiseIntensityEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseIntensity", "0.00" );
   nxtDenoiseIntensityEdit.toolTip = "<p>NXT intensity/luminance denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseColorEdit = new Edit( this );
   this.nxtDenoiseColorEdit = nxtDenoiseColorEdit;
   nxtDenoiseColorEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseColor", "0.00" );
   nxtDenoiseColorEdit.toolTip = "<p>NXT chrominance/color denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseHighFreqEdit = new Edit( this );
   this.nxtDenoiseHighFreqEdit = nxtDenoiseHighFreqEdit;
   nxtDenoiseHighFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseHighFreq", "0.00" );
   nxtDenoiseHighFreqEdit.toolTip = "<p>NXT high-frequency small-scale denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseLowFreqEdit = new Edit( this );
   this.nxtDenoiseLowFreqEdit = nxtDenoiseLowFreqEdit;
   nxtDenoiseLowFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseLowFreq", "0.00" );
   nxtDenoiseLowFreqEdit.toolTip = "<p>NXT low-frequency large-scale denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseIntensityHighFreqEdit = new Edit( this );
   this.nxtDenoiseIntensityHighFreqEdit = nxtDenoiseIntensityHighFreqEdit;
   nxtDenoiseIntensityHighFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseIntensityHighFreq", "0.00" );
   nxtDenoiseIntensityHighFreqEdit.toolTip = "<p>NXT high-frequency intensity denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseIntensityLowFreqEdit = new Edit( this );
   this.nxtDenoiseIntensityLowFreqEdit = nxtDenoiseIntensityLowFreqEdit;
   nxtDenoiseIntensityLowFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseIntensityLowFreq", "0.00" );
   nxtDenoiseIntensityLowFreqEdit.toolTip = "<p>NXT low-frequency intensity denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseColorHighFreqEdit = new Edit( this );
   this.nxtDenoiseColorHighFreqEdit = nxtDenoiseColorHighFreqEdit;
   nxtDenoiseColorHighFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseColorHighFreq", "0.00" );
   nxtDenoiseColorHighFreqEdit.toolTip = "<p>NXT high-frequency color denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtDenoiseColorLowFreqEdit = new Edit( this );
   this.nxtDenoiseColorLowFreqEdit = nxtDenoiseColorLowFreqEdit;
   nxtDenoiseColorLowFreqEdit.text = settingsReadString( settingsPrefix + "nxtDenoiseColorLowFreq", "0.00" );
   nxtDenoiseColorLowFreqEdit.toolTip = "<p>NXT low-frequency color denoise strength. Range: 0.0 to 1.0.</p>";

   var nxtFrequencyScaleEdit = new Edit( this );
   this.nxtFrequencyScaleEdit = nxtFrequencyScaleEdit;
   nxtFrequencyScaleEdit.text = settingsReadString( settingsPrefix + "nxtFrequencyScale", "5.0" );
   nxtFrequencyScaleEdit.toolTip = "<p>Pixel scale of the low/high frequency transition band. Range: 1 to 100.</p>";

   var nxtIterationsEdit = new Edit( this );
   this.nxtIterationsEdit = nxtIterationsEdit;
   nxtIterationsEdit.text = settingsReadString( settingsPrefix + "nxtIterations", "2" );
   nxtIterationsEdit.toolTip = "<p>Number of denoising iterations. Range: 1 to 5.</p>";

   var nxtExtraArgsEdit = new Edit( this );
   this.nxtExtraArgsEdit = nxtExtraArgsEdit;
   nxtExtraArgsEdit.text = settingsReadString( settingsPrefix + "nxtExtraArgs", "" );
   nxtExtraArgsEdit.toolTip = "<p>Additional NXT-only arguments appended after explicit NXT options.</p>";

   // --------------------------------------------------------------------------
   // Common controls
   // --------------------------------------------------------------------------

   var deviceEdit = new Edit( this );
   this.deviceEdit = deviceEdit;
   deviceEdit.text = settingsReadString( settingsPrefix + "device", "" );
   deviceEdit.toolTip = "<p>Compute device. Values: auto, cpu, gpu, gpuN. Leave blank for RC-Astro default.</p>";
   deviceEdit.visible = false;

   var mlVersionEdit = new Edit( this );
   this.mlVersionEdit = mlVersionEdit;
   mlVersionEdit.text = settingsReadString( settingsPrefix + "mlVersion", "" );
   mlVersionEdit.toolTip = "<p>Model version. 0 means latest. Leave blank for the RC-Astro default. The current NoiseXTerminator ML3 model is faster on Windows and Linux while producing identical results; the macOS ML3 model is unchanged.</p>";
   mlVersionEdit.visible = false;

   var overlapEdit = new Edit( this );
   this.overlapEdit = overlapEdit;
   overlapEdit.text = settingsReadString( settingsPrefix + "overlap", "" );
   overlapEdit.toolTip = "<p>Tile overlap fraction. Range: 0.0 to 0.5. Leave blank for RC-Astro default.</p>";
   overlapEdit.visible = false;

   var outputDepthEdit = new Edit( this );
   this.outputDepthEdit = outputDepthEdit;
   outputDepthEdit.text = settingsReadString( settingsPrefix + "outputDepth", "" );
   outputDepthEdit.toolTip = "<p>Output bit depth. Values: 8U, 16U, 32F, 64F. Leave blank to match input.</p>";
   outputDepthEdit.visible = false;

   var commonExtraArgsEdit = new Edit( this );
   this.commonExtraArgsEdit = commonExtraArgsEdit;
   commonExtraArgsEdit.text = settingsReadString( settingsPrefix + "commonExtraArgs", "" );
   commonExtraArgsEdit.toolTip = "<p>Additional RC-Astro arguments appended after common options.</p>";
   commonExtraArgsEdit.visible = false;

   var statusText = new TextBox( this );
   this.statusText = statusText;
   statusText.readOnly = true;
   statusText.minHeight = 330;
   if ( startupCliVersion != null )
      statusText.text =
         "READY\n\n" +
         "RC-Astro CLI version: " + versionString( startupCliVersion ) + "\n" +
         "Executable: " + startupExecutable + "\n\n" +
         "Default mode uses the active/target PixInsight view.\n\n" +
         "Only arguments relevant to the selected command are displayed.";
   else
      statusText.text =
         "NOT READY\n\n" +
         "A compatible RC-Astro CLI installation was not detected.\n\n" +
         startupCliError + "\n\n" +
         "Open Preferences with the wrench button to select the executable.";



   // --------------------------------------------------------------------------
   // Layout rows
   // --------------------------------------------------------------------------

   var modeSizer = new HorizontalSizer;
   modeSizer.spacing = 6;
   modeSizer.addSpacing( 141 );
   modeSizer.add( useActiveViewCheck );
   modeSizer.addStretch();

   var toolLabel = makeLabel( this, "Tool:" );

   var toolSizer = new HorizontalSizer;
   toolSizer.spacing = 6;
   toolSizer.add( toolLabel );
   toolSizer.add( toolCombo );
   toolSizer.addStretch();

   var inputRow = makePathRow(
      this,
      "Input file:",
      inputEdit,
      "Browse",
      function()
      {
         var p = selectOpenFile(
            "Select input image",
            [
               [ "Image files", "*.xisf *.fits *.fit *.tif *.tiff *.png" ],
               [ "XISF files", "*.xisf" ],
               [ "TIFF files", "*.tif *.tiff" ],
               [ "FITS files", "*.fits *.fit" ],
               [ "PNG files", "*.png" ],
               [ "All files", "*" ]
            ]
         );

         if ( p.length > 0 )
            self.inputEdit.text = p;
      }
   );

   var outputRow = makePathRow(
      this,
      "Output file:",
      outputEdit,
      "Browse",
      function()
      {
         var p = selectSaveFile(
            "Select output image",
            [
               [ "XISF files", "*.xisf" ],
               [ "TIFF files", "*.tif *.tiff" ],
               [ "FITS files", "*.fits *.fit" ],
               [ "PNG files", "*.png" ],
               [ "All files", "*" ]
            ]
         );

         if ( p.length > 0 )
            self.outputEdit.text = p;
      }
   );

   var logRow = makePathRow(
      this,
      "Log:",
      logEdit,
      "Browse",
      function()
      {
         var p = selectSaveFile(
            "Select log file",
            [
               [ "Log files", "*.log *.txt" ],
               [ "All files", "*" ]
            ]
         );

         if ( p.length > 0 )
            self.logEdit.text = p;
      }
   );

   // BXT rows
   var bxtStarsLabel = makeLabel( this, "BXT stars:" );
   var bxtNonstellarLabel = makeLabel( this, "BXT nonstellar:" );
   var bxtHalosLabel = makeLabel( this, "BXT halos:" );
   var bxtRadiusLabel = makeLabel( this, "BXT radius:" );
   var bxtExtraLabel = makeLabel( this, "BXT extra args:" );

   var bxtSharpenRow = new HorizontalSizer;
   bxtSharpenRow.spacing = 6;
   bxtSharpenRow.add( bxtStarsLabel );
   bxtSharpenRow.add( bxtSharpenStarsEdit );
   bxtSharpenRow.add( bxtNonstellarLabel );
   bxtSharpenRow.add( bxtSharpenNonstellarEdit );
   bxtSharpenRow.addStretch();

   var bxtHaloRadiusRow = new HorizontalSizer;
   bxtHaloRadiusRow.spacing = 6;
   bxtHaloRadiusRow.add( bxtHalosLabel );
   bxtHaloRadiusRow.add( bxtAdjustStarHalosEdit );
   bxtHaloRadiusRow.add( bxtRadiusLabel );
   bxtHaloRadiusRow.add( bxtNonstellarDiameterEdit );
   bxtHaloRadiusRow.addStretch();

   var bxtCheckRow = new HorizontalSizer;
   bxtCheckRow.spacing = 6;
   bxtCheckRow.addSpacing( 141 );
   bxtCheckRow.add( bxtAutoNonstellarPsfCheck );
   bxtCheckRow.addSpacing( 20 );
   bxtCheckRow.add( bxtCorrectOnlyCheck );
   bxtCheckRow.addStretch();

   bxtExtraArgsEdit.minWidth = 560;
   var bxtExtraRow = new HorizontalSizer;
   bxtExtraRow.spacing = 6;
   bxtExtraRow.add( bxtExtraLabel );
   bxtExtraRow.add( bxtExtraArgsEdit, 100 );

   // SXT rows
   var sxtExtraLabel = makeLabel( this, "SXT extra args:" );

   var sxtRow = new HorizontalSizer;
   sxtRow.spacing = 6;
   sxtRow.addSpacing( 141 );
   sxtRow.add( sxtStarsCheck );
   sxtRow.addSpacing( 20 );
   sxtRow.add( sxtUnscreenCheck );
   sxtRow.addStretch();

   sxtExtraArgsEdit.minWidth = 560;
   var sxtExtraRow = new HorizontalSizer;
   sxtExtraRow.spacing = 6;
   sxtExtraRow.add( sxtExtraLabel );
   sxtExtraRow.add( sxtExtraArgsEdit, 100 );

   // NXT rows
   var nxtStrengthRow;
   var nxtFreqRow;
   var nxtIntensityFreqRow;
   var nxtColorFreqRow;
   var nxtDenoiseLabel = makeLabel( this, "Denoise:" );
   var nxtIntensityLabel = makeLabel( this, "Intensity:" );
   var nxtColorLabel = makeLabel( this, "Color:" );
   var nxtHighFreqLabel = makeLabel( this, "High freq:" );
   var nxtLowFreqLabel = makeLabel( this, "Low freq:" );
   var nxtFreqScaleLabel = makeLabel( this, "Freq scale:" );
   var nxtIntHighLabel = makeLabel( this, "Int high:" );
   var nxtIntLowLabel = makeLabel( this, "Int low:" );
   var nxtIterationsLabel = makeLabel( this, "Iterations:" );
   var nxtColorHighLabel = makeLabel( this, "Color high:" );
   var nxtColorLowLabel = makeLabel( this, "Color low:" );
   var nxtExtraLabel = makeLabel( this, "NXT extra args:" );

   nxtStrengthRow = new HorizontalSizer;
   nxtStrengthRow.spacing = 6;
   nxtStrengthRow.add( nxtDenoiseLabel );
   nxtStrengthRow.add( nxtDenoiseEdit );
   nxtStrengthRow.add( nxtIntensityLabel );
   nxtStrengthRow.add( nxtDenoiseIntensityEdit );
   nxtStrengthRow.add( nxtColorLabel );
   nxtStrengthRow.add( nxtDenoiseColorEdit );
   nxtStrengthRow.addStretch();

   nxtFreqRow = new HorizontalSizer;
   nxtFreqRow.spacing = 6;
   nxtFreqRow.add( nxtHighFreqLabel );
   nxtFreqRow.add( nxtDenoiseHighFreqEdit );
   nxtFreqRow.add( nxtLowFreqLabel );
   nxtFreqRow.add( nxtDenoiseLowFreqEdit );
   nxtFreqRow.add( nxtFreqScaleLabel );
   nxtFreqRow.add( nxtFrequencyScaleEdit );
   nxtFreqRow.addStretch();

   nxtIntensityFreqRow = new HorizontalSizer;
   nxtIntensityFreqRow.spacing = 6;
   nxtIntensityFreqRow.add( nxtIntHighLabel );
   nxtIntensityFreqRow.add( nxtDenoiseIntensityHighFreqEdit );
   nxtIntensityFreqRow.add( nxtIntLowLabel );
   nxtIntensityFreqRow.add( nxtDenoiseIntensityLowFreqEdit );
   nxtIntensityFreqRow.add( nxtIterationsLabel );
   nxtIntensityFreqRow.add( nxtIterationsEdit );
   nxtIntensityFreqRow.addStretch();

   nxtColorFreqRow = new HorizontalSizer;
   nxtColorFreqRow.spacing = 6;
   nxtColorFreqRow.add( nxtColorHighLabel );
   nxtColorFreqRow.add( nxtDenoiseColorHighFreqEdit );
   nxtColorFreqRow.add( nxtColorLowLabel );
   nxtColorFreqRow.add( nxtDenoiseColorLowFreqEdit );
   nxtColorFreqRow.addStretch();

   nxtExtraArgsEdit.minWidth = 560;
   var nxtExtraRow = new HorizontalSizer;
   nxtExtraRow.spacing = 6;
   nxtExtraRow.add( nxtExtraLabel );
   nxtExtraRow.add( nxtExtraArgsEdit, 100 );

   // Sections shown/hidden depending on selected tool
   var bxtSectionRows = new Array;
   bxtSectionRows.push( bxtSharpenRow );
   bxtSectionRows.push( bxtHaloRadiusRow );
   bxtSectionRows.push( bxtCheckRow );
   bxtSectionRows.push( bxtExtraRow );

   var sxtSectionRows = new Array;
   sxtSectionRows.push( sxtRow );
   sxtSectionRows.push( sxtExtraRow );

   var nxtSectionRows = new Array;
   nxtSectionRows.push( nxtStrengthRow );
   nxtSectionRows.push( nxtFreqRow );
   nxtSectionRows.push( nxtIntensityFreqRow );
   nxtSectionRows.push( nxtColorFreqRow );
   nxtSectionRows.push( nxtExtraRow );

   var runButton = new PushButton( this );
   this.runButton = runButton;
   runButton.text = "Run RC-Astro";

   var newInstanceButton = new ToolButton( this );
   this.newInstanceButton = newInstanceButton;
   newInstanceButton.icon = this.scaledResource(
      ":/process-interface/new-instance.png"
   );
   newInstanceButton.setScaledFixedSize( 24, 24 );
   newInstanceButton.toolTip =
      "<p>Create a new process instance with the current RC-Astro " +
      "processing settings.</p>";

   var preferencesButton = new ToolButton( this );
   this.preferencesButton = preferencesButton;
   preferencesButton.icon = this.scaledResource( ":/icons/wrench.png" );
   preferencesButton.setScaledFixedSize( 24, 24 );
   preferencesButton.toolTip = "<p>Preferences</p>";

   var closeButton = new PushButton( this );
   this.closeButton = closeButton;
   closeButton.text = "Close";

   var documentationButton = new ToolButton( this );
   this.documentationButton = documentationButton;
   documentationButton.icon = this.scaledResource(
      ":/process-interface/browse-documentation.png"
   );
   documentationButton.setScaledFixedSize( 24, 24 );
   documentationButton.toolTip = "<p>Browse Documentation</p>";

   var buttonSizer = new HorizontalSizer;
   buttonSizer.spacing = 8;
   buttonSizer.add( newInstanceButton );
   buttonSizer.addStretch();
   buttonSizer.add( preferencesButton );
   buttonSizer.add( documentationButton );
   buttonSizer.add( runButton );
   buttonSizer.add( closeButton );

   var mainSizer = new VerticalSizer;
   this.sizer = mainSizer;
   mainSizer.margin = 8;
   mainSizer.spacing = 6;

   mainSizer.add( headerLabel );
   mainSizer.add( introductionLabel );
   mainSizer.add( modeSizer );
   mainSizer.add( toolSizer );
   mainSizer.add( inputRow );
   mainSizer.add( outputRow );
   mainSizer.add( logRow );
   mainSizer.addSpacing( 4 );

   mainSizer.add( makeSection( this, "BlurXTerminator arguments", bxtSectionRows ) );
   mainSizer.add( makeSection( this, "StarXTerminator arguments", sxtSectionRows ) );
   mainSizer.add( makeSection( this, "NoiseXTerminator arguments", nxtSectionRows ) );

   mainSizer.addSpacing( 6 );
   mainSizer.add( statusText );
   mainSizer.addSpacing( 6 );
   mainSizer.add( buttonSizer );

   // --------------------------------------------------------------------------
   // Dynamic tool visibility
   // --------------------------------------------------------------------------

   function setToolControlsVisible( controls, visible )
   {
      for ( var i = 0; i < controls.length; ++i )
         controls[i].visible = visible;
   }

   var bxtToolControls = [
      bxtStarsLabel,
      bxtSharpenStarsEdit,
      bxtNonstellarLabel,
      bxtSharpenNonstellarEdit,
      bxtHalosLabel,
      bxtAdjustStarHalosEdit,
      bxtRadiusLabel,
      bxtNonstellarDiameterEdit,
      bxtAutoNonstellarPsfCheck,
      bxtCorrectOnlyCheck,
      bxtExtraLabel,
      bxtExtraArgsEdit
   ];

   var sxtToolControls = [
      sxtStarsCheck,
      sxtUnscreenCheck,
      sxtExtraLabel,
      sxtExtraArgsEdit
   ];

   var nxtToolControls = [
      nxtDenoiseLabel,
      nxtDenoiseEdit,
      nxtIntensityLabel,
      nxtDenoiseIntensityEdit,
      nxtColorLabel,
      nxtDenoiseColorEdit,
      nxtHighFreqLabel,
      nxtDenoiseHighFreqEdit,
      nxtLowFreqLabel,
      nxtDenoiseLowFreqEdit,
      nxtFreqScaleLabel,
      nxtFrequencyScaleEdit,
      nxtIntHighLabel,
      nxtDenoiseIntensityHighFreqEdit,
      nxtIntLowLabel,
      nxtDenoiseIntensityLowFreqEdit,
      nxtIterationsLabel,
      nxtIterationsEdit,
      nxtColorHighLabel,
      nxtDenoiseColorHighFreqEdit,
      nxtColorLowLabel,
      nxtDenoiseColorLowFreqEdit,
      nxtExtraLabel,
      nxtExtraArgsEdit
   ];

   this.updateToolVisibility = function()
   {
      var tool = self.toolCombo.itemText( self.toolCombo.currentItem );
      var isBxt = ( tool == "bxt" );
      var isSxt = ( tool == "sxt" );
      var isNxt = ( tool == "nxt" );

      bxtSharpenRow.visible = isBxt;
      bxtHaloRadiusRow.visible = isBxt;
      bxtCheckRow.visible = isBxt;
      bxtExtraRow.visible = isBxt;
      setToolControlsVisible( bxtToolControls, isBxt );

      sxtRow.visible = isSxt;
      sxtExtraRow.visible = isSxt;
      setToolControlsVisible( sxtToolControls, isSxt );

      nxtStrengthRow.visible = isNxt;
      nxtFreqRow.visible = isNxt;
      nxtIntensityFreqRow.visible = isNxt;
      nxtColorFreqRow.visible = isNxt;
      nxtExtraRow.visible = isNxt;
      setToolControlsVisible( nxtToolControls, isNxt );

      if ( !self.useActiveViewCheck.checked )
      {
         var currentOutput = trimString( self.outputEdit.text );

         if ( currentOutput.length > 0 )
         {
            if ( tool == "bxt" )
               self.outputEdit.text = currentOutput.replace( /_(bxt|sxt|nxt)\.xisf$/i, "_bxt.xisf" );
            else if ( tool == "sxt" )
               self.outputEdit.text = currentOutput.replace( /_(bxt|sxt|nxt)\.xisf$/i, "_sxt.xisf" );
            else if ( tool == "nxt" )
               self.outputEdit.text = currentOutput.replace( /_(bxt|sxt|nxt)\.xisf$/i, "_nxt.xisf" );
         }
      }

      self.adjustToContents();
   };

   // --------------------------------------------------------------------------
   // Events
   // --------------------------------------------------------------------------

   toolCombo.onItemSelected = function()
   {
      self.updateToolVisibility();
      self.saveSettings();
   };

   closeButton.onClick = function()
   {
      if ( self.processRunning )
      {
         self.cancelRequested = true;
         self.closeButton.enabled = false;
         self.closeButton.text = "Cancelling...";
         return;
      }

      self.saveSettings();
      self.cancel();
   };

   preferencesButton.onClick = function()
   {
      showPreferencesDialog();
   };

   documentationButton.onClick = function()
   {
      var localDocumentation = pathJoin(
         RCASTRO_SCRIPT_DIRECTORY,
         "doc/scripts/RC-Astro CLI Wrapper/RC-Astro CLI Wrapper.html"
      );
      if ( fileExists( localDocumentation ) )
      {
         Dialog.openBrowser( localDocumentation );
         return;
      }

      if ( Dialog.browseScriptDocumentation( "RC-Astro CLI Wrapper" ) )
         return;

      showWarning(
         "Documentation unavailable",
         "The compiled RC-Astro PIDoc document is not installed or bundled. " +
         "Compile Documentation/RcAstro/RcAstro.pidoc with " +
         "Development > DocumentationCompiler."
      );
   };

   runButton.onClick = function()
   {
      self.saveSettings();
      self.runRCAstro();
   };

   newInstanceButton.onMousePress = function()
   {
      this.hasFocus = true;
      this.pushed = false;

      try
      {
         self.exportInstanceParameters();
         self.saveSettings();
         self.newInstance();
      }
      catch ( e )
      {
         writeConsoleError( "Process instance creation failed", e.toString() );
         self.statusText.text =
            "ERROR\n\nCould not create the process instance.\n\n" +
            e.toString();
      }
   };

   this.saveSettings = function()
   {
      settingsWriteString( settingsPrefix + "exe", self.exeEdit.text );
      settingsWriteString( settingsPrefix + "tempDir", self.tempDirEdit.text );
      settingsWriteString( settingsPrefix + "input", self.inputEdit.text );
      settingsWriteString( settingsPrefix + "output", self.outputEdit.text );
      settingsWriteString( settingsPrefix + "log", self.logEdit.text );
      settingsWriteString( settingsPrefix + "tool", self.toolCombo.itemText( self.toolCombo.currentItem ) );
      settingsWriteString( settingsPrefix + "device", self.deviceEdit.text );
      settingsWriteString( settingsPrefix + "mlVersion", self.mlVersionEdit.text );
      settingsWriteString( settingsPrefix + "overlap", self.overlapEdit.text );
      settingsWriteString( settingsPrefix + "outputDepth", self.outputDepthEdit.text );
      settingsWriteString( settingsPrefix + "commonExtraArgs", self.commonExtraArgsEdit.text );
      settingsWriteString( settingsPrefix + "bxtSharpenStars", self.bxtSharpenStarsEdit.text );
      settingsWriteString( settingsPrefix + "bxtAdjustStarHalos", self.bxtAdjustStarHalosEdit.text );
      settingsWriteString( settingsPrefix + "bxtNonstellarDiameter", self.bxtNonstellarDiameterEdit.text );
      settingsWriteString( settingsPrefix + "bxtSharpenNonstellar", self.bxtSharpenNonstellarEdit.text );
      settingsWriteString( settingsPrefix + "bxtExtraArgs", self.bxtExtraArgsEdit.text );
      settingsWriteBoolean( settingsPrefix + "useActiveView", self.useActiveViewCheck.checked );
      settingsWriteBoolean( settingsPrefix + "openResult", self.openResultCheck.checked );
      settingsWriteBoolean( settingsPrefix + "keepTemp", self.keepTempCheck.checked );
      settingsWriteBoolean( settingsPrefix + "overwrite", self.overwriteCheck.checked );
      settingsWriteBoolean( settingsPrefix + "debug", self.debugCheck.checked );
      settingsWriteBoolean( settingsPrefix + "bxtAutoNonstellarPsf", self.bxtAutoNonstellarPsfCheck.checked );
      settingsWriteBoolean( settingsPrefix + "bxtCorrectOnly", self.bxtCorrectOnlyCheck.checked );
      settingsWriteBoolean( settingsPrefix + "sxtStars", self.sxtStarsCheck.checked );
      settingsWriteBoolean( settingsPrefix + "sxtUnscreen", self.sxtUnscreenCheck.checked );
      settingsWriteString( settingsPrefix + "sxtExtraArgs", self.sxtExtraArgsEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoise", self.nxtDenoiseEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseIntensity", self.nxtDenoiseIntensityEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseColor", self.nxtDenoiseColorEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseHighFreq", self.nxtDenoiseHighFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseLowFreq", self.nxtDenoiseLowFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseIntensityHighFreq", self.nxtDenoiseIntensityHighFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseIntensityLowFreq", self.nxtDenoiseIntensityLowFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseColorHighFreq", self.nxtDenoiseColorHighFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtDenoiseColorLowFreq", self.nxtDenoiseColorLowFreqEdit.text );
      settingsWriteString( settingsPrefix + "nxtFrequencyScale", self.nxtFrequencyScaleEdit.text );
      settingsWriteString( settingsPrefix + "nxtIterations", self.nxtIterationsEdit.text );
      settingsWriteString( settingsPrefix + "nxtExtraArgs", self.nxtExtraArgsEdit.text );
   };

   // Process icons are portable processing snapshots. Machine-local paths and
   // transient execution state are intentionally not serialized.
   this.exportInstanceParameters = function()
   {
      Parameters.clear();
      Parameters.set( "rcAstroSchemaVersion", 1 );
      Parameters.set( "useActiveView", self.useActiveViewCheck.checked );
      Parameters.set( "tool", self.toolCombo.itemText( self.toolCombo.currentItem ) );

      if ( !self.useActiveViewCheck.checked )
      {
         Parameters.set( "inputFile", self.inputEdit.text );
         Parameters.set( "outputFile", self.outputEdit.text );
         Parameters.set( "logFile", self.logEdit.text );
      }

      Parameters.set( "openResult", self.openResultCheck.checked );
      Parameters.set( "keepTemp", self.keepTempCheck.checked );
      Parameters.set( "overwrite", self.overwriteCheck.checked );
      Parameters.set( "debug", self.debugCheck.checked );
      Parameters.set( "device", self.deviceEdit.text );
      Parameters.set( "mlVersion", self.mlVersionEdit.text );
      Parameters.set( "overlap", self.overlapEdit.text );
      Parameters.set( "outputDepth", self.outputDepthEdit.text );
      Parameters.set( "commonExtraArgs", self.commonExtraArgsEdit.text );

      Parameters.set( "bxtSharpenStars", self.bxtSharpenStarsEdit.text );
      Parameters.set( "bxtAdjustStarHalos", self.bxtAdjustStarHalosEdit.text );
      Parameters.set( "bxtNonstellarDiameter", self.bxtNonstellarDiameterEdit.text );
      Parameters.set( "bxtSharpenNonstellar", self.bxtSharpenNonstellarEdit.text );
      Parameters.set( "bxtAutoNonstellarPsf", self.bxtAutoNonstellarPsfCheck.checked );
      Parameters.set( "bxtCorrectOnly", self.bxtCorrectOnlyCheck.checked );
      Parameters.set( "bxtExtraArgs", self.bxtExtraArgsEdit.text );

      Parameters.set( "sxtStars", self.sxtStarsCheck.checked );
      Parameters.set( "sxtUnscreen", self.sxtUnscreenCheck.checked );
      Parameters.set( "sxtExtraArgs", self.sxtExtraArgsEdit.text );

      Parameters.set( "nxtDenoise", self.nxtDenoiseEdit.text );
      Parameters.set( "nxtDenoiseIntensity", self.nxtDenoiseIntensityEdit.text );
      Parameters.set( "nxtDenoiseColor", self.nxtDenoiseColorEdit.text );
      Parameters.set( "nxtDenoiseHighFreq", self.nxtDenoiseHighFreqEdit.text );
      Parameters.set( "nxtDenoiseLowFreq", self.nxtDenoiseLowFreqEdit.text );
      Parameters.set( "nxtDenoiseIntensityHighFreq", self.nxtDenoiseIntensityHighFreqEdit.text );
      Parameters.set( "nxtDenoiseIntensityLowFreq", self.nxtDenoiseIntensityLowFreqEdit.text );
      Parameters.set( "nxtDenoiseColorHighFreq", self.nxtDenoiseColorHighFreqEdit.text );
      Parameters.set( "nxtDenoiseColorLowFreq", self.nxtDenoiseColorLowFreqEdit.text );
      Parameters.set( "nxtFrequencyScale", self.nxtFrequencyScaleEdit.text );
      Parameters.set( "nxtIterations", self.nxtIterationsEdit.text );
      Parameters.set( "nxtExtraArgs", self.nxtExtraArgsEdit.text );
   };

   function importStringParameter( name, control )
   {
      if ( Parameters.has( name ) )
         control.text = Parameters.getString( name );
   }

   function importBooleanParameter( name, control )
   {
      if ( Parameters.has( name ) )
         control.checked = Parameters.getBoolean( name );
   }

   this.importInstanceParameters = function()
   {
      if ( !Parameters.has( "rcAstroSchemaVersion" ) )
         return false;

      try
      {
         var schemaVersion = Parameters.getInteger( "rcAstroSchemaVersion" );
         if ( schemaVersion > 1 )
            writeConsoleWarning(
               "Newer process instance format",
               "This instance uses schema " + schemaVersion +
               "; this wrapper supports schema 1. Unknown parameters will be ignored."
            );

         importBooleanParameter( "useActiveView", self.useActiveViewCheck );

         if ( Parameters.has( "tool" ) )
         {
            var instanceTool = Parameters.getString( "tool" ).toLowerCase();
            if ( instanceTool == "bxt" )
               self.toolCombo.currentItem = 0;
            else if ( instanceTool == "sxt" )
               self.toolCombo.currentItem = 1;
            else if ( instanceTool == "nxt" )
               self.toolCombo.currentItem = 2;
            else
               writeConsoleWarning(
                  "Invalid process instance parameter",
                  "Unknown RC-Astro tool '" + instanceTool +
                  "'. The current tool selection has been retained."
               );
         }

         if ( !self.useActiveViewCheck.checked )
         {
            importStringParameter( "inputFile", self.inputEdit );
            importStringParameter( "outputFile", self.outputEdit );
            importStringParameter( "logFile", self.logEdit );
         }

         importBooleanParameter( "openResult", self.openResultCheck );
         importBooleanParameter( "keepTemp", self.keepTempCheck );
         importBooleanParameter( "overwrite", self.overwriteCheck );
         importBooleanParameter( "debug", self.debugCheck );
         importStringParameter( "device", self.deviceEdit );
         importStringParameter( "mlVersion", self.mlVersionEdit );
         importStringParameter( "overlap", self.overlapEdit );
         importStringParameter( "outputDepth", self.outputDepthEdit );
         importStringParameter( "commonExtraArgs", self.commonExtraArgsEdit );

         importStringParameter( "bxtSharpenStars", self.bxtSharpenStarsEdit );
         importStringParameter( "bxtAdjustStarHalos", self.bxtAdjustStarHalosEdit );
         importStringParameter( "bxtNonstellarDiameter", self.bxtNonstellarDiameterEdit );
         importStringParameter( "bxtSharpenNonstellar", self.bxtSharpenNonstellarEdit );
         importBooleanParameter( "bxtAutoNonstellarPsf", self.bxtAutoNonstellarPsfCheck );
         importBooleanParameter( "bxtCorrectOnly", self.bxtCorrectOnlyCheck );
         importStringParameter( "bxtExtraArgs", self.bxtExtraArgsEdit );

         importBooleanParameter( "sxtStars", self.sxtStarsCheck );
         importBooleanParameter( "sxtUnscreen", self.sxtUnscreenCheck );
         importStringParameter( "sxtExtraArgs", self.sxtExtraArgsEdit );

         importStringParameter( "nxtDenoise", self.nxtDenoiseEdit );
         importStringParameter( "nxtDenoiseIntensity", self.nxtDenoiseIntensityEdit );
         importStringParameter( "nxtDenoiseColor", self.nxtDenoiseColorEdit );
         importStringParameter( "nxtDenoiseHighFreq", self.nxtDenoiseHighFreqEdit );
         importStringParameter( "nxtDenoiseLowFreq", self.nxtDenoiseLowFreqEdit );
         importStringParameter( "nxtDenoiseIntensityHighFreq", self.nxtDenoiseIntensityHighFreqEdit );
         importStringParameter( "nxtDenoiseIntensityLowFreq", self.nxtDenoiseIntensityLowFreqEdit );
         importStringParameter( "nxtDenoiseColorHighFreq", self.nxtDenoiseColorHighFreqEdit );
         importStringParameter( "nxtDenoiseColorLowFreq", self.nxtDenoiseColorLowFreqEdit );
         importStringParameter( "nxtFrequencyScale", self.nxtFrequencyScaleEdit );
         importStringParameter( "nxtIterations", self.nxtIterationsEdit );
         importStringParameter( "nxtExtraArgs", self.nxtExtraArgsEdit );

         writeConsoleInfo(
            "Process instance restored",
            "RC-Astro processing settings were loaded from a process instance."
         );
         return true;
      }
      catch ( e )
      {
         writeConsoleError(
            "Invalid process instance",
            "The stored RC-Astro settings could not be restored completely.\n" +
            e.toString()
         );
         self.statusText.text =
            "ERROR\n\nThe process instance contains invalid parameters.\n\n" +
            e.toString();
         return false;
      }
   };

   this.importInstanceParameters();

   function bindAutosave( control )
   {
      try
      {
         control.onTextUpdated = function()
         {
            self.saveSettings();
         };
      }
      catch ( ignored1 )
      {
      }

      try
      {
         control.onEditCompleted = function()
         {
            self.saveSettings();
         };
      }
      catch ( ignored2 )
      {
      }

      try
      {
         control.onClick = function()
         {
            self.saveSettings();
         };
      }
      catch ( ignored3 )
      {
      }
   }

   bindAutosave( bxtSharpenStarsEdit );
   bindAutosave( bxtAdjustStarHalosEdit );
   bindAutosave( bxtNonstellarDiameterEdit );
   bindAutosave( bxtSharpenNonstellarEdit );
   bindAutosave( bxtExtraArgsEdit );
   bindAutosave( bxtAutoNonstellarPsfCheck );
   bindAutosave( bxtCorrectOnlyCheck );
   bindAutosave( sxtStarsCheck );
   bindAutosave( sxtUnscreenCheck );
   bindAutosave( sxtExtraArgsEdit );
   bindAutosave( nxtDenoiseEdit );
   bindAutosave( nxtDenoiseIntensityEdit );
   bindAutosave( nxtDenoiseColorEdit );
   bindAutosave( nxtDenoiseHighFreqEdit );
   bindAutosave( nxtDenoiseLowFreqEdit );
   bindAutosave( nxtDenoiseIntensityHighFreqEdit );
   bindAutosave( nxtDenoiseIntensityLowFreqEdit );
   bindAutosave( nxtDenoiseColorHighFreqEdit );
   bindAutosave( nxtDenoiseColorLowFreqEdit );
   bindAutosave( nxtFrequencyScaleEdit );
   bindAutosave( nxtIterationsEdit );
   bindAutosave( nxtExtraArgsEdit );

   useActiveViewCheck.onClick = function()
   {
      self.saveSettings();
   };

   // --------------------------------------------------------------------------
   // Main execution
   // --------------------------------------------------------------------------

   this.runRCAstro = function()
   {
      var rcAstroExe = trimString( self.exeEdit.text );
      var tempDir = trimString( self.tempDirEdit.text );
      var inputFile = trimString( self.inputEdit.text );
      var outputFile = trimString( self.outputEdit.text );
      var logFile = trimString( self.logEdit.text );

      var useActiveView = self.useActiveViewCheck.checked;
      var openResult = self.openResultCheck.checked;
      var keepTemp = self.keepTempCheck.checked;

      var tool = self.toolCombo.itemText( self.toolCombo.currentItem );

      var targetView = null;
      var targetId = "";
      var outputWindow = null;
      var inputDisplayState = null;
      var resultDisplayDescription = "not applicable";
      var temporaryInputFile = "";
      var wasCancelled = false;

      var log = "";
      log += "===== RC-Astro CLI run =====\n";
      log += "Started:    " + nowString() + "\n";
      log += "Executable: " + rcAstroExe + "\n";
      log += "Tool:       " + tool + "\n";
      log += "Mode:       " + ( useActiveView ? "active PixInsight view" : "manual file" ) + "\n";

      try
      {
         if ( rcAstroExe.length == 0 )
            throw new Error( "No rc-astro executable specified." );

         if ( !fileExists( rcAstroExe ) )
            throw new Error( "RC-Astro executable not found:\n" + rcAstroExe );

         if ( directoryExists( rcAstroExe ) )
            throw new Error( "The RC-Astro executable path points to a directory:\n" + rcAstroExe );

         var installedCliVersion = verifyRCAstroCompatibility( rcAstroExe );
         log += "CLI version: " + versionString( installedCliVersion ) + "\n";

         if ( tool != "bxt" && tool != "sxt" && tool != "nxt" )
            throw new Error( "Unsupported RC-Astro command: " + tool );

         if ( tool == "bxt" )
         {
            validateOptionalNumber( "BXT sharpen stars", self.bxtSharpenStarsEdit.text, 0, 0.7 );
            validateOptionalNumber( "BXT adjust star halos", self.bxtAdjustStarHalosEdit.text, -0.5, 0.5 );
            validateOptionalNumber( "BXT nonstellar diameter", self.bxtNonstellarDiameterEdit.text, 0, 16 );
            validateOptionalNumber( "BXT sharpen nonstellar", self.bxtSharpenNonstellarEdit.text, 0, 1 );

            if ( self.bxtAutoNonstellarPsfCheck.checked &&
                 trimString( self.bxtNonstellarDiameterEdit.text ).length > 0 &&
                 Number( self.bxtNonstellarDiameterEdit.text ) != 0 )
               throw new Error( "BXT nonstellar diameter must be 0.0 when automatic nonstellar PSF is enabled." );
         }
         else if ( tool == "nxt" )
         {
            validateOptionalNumber( "NXT denoise", self.nxtDenoiseEdit.text, 0, 1 );
            validateOptionalNumber( "NXT intensity denoise", self.nxtDenoiseIntensityEdit.text, 0, 1 );
            validateOptionalNumber( "NXT color denoise", self.nxtDenoiseColorEdit.text, 0, 1 );
            validateOptionalNumber( "NXT high-frequency denoise", self.nxtDenoiseHighFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT low-frequency denoise", self.nxtDenoiseLowFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT intensity high-frequency denoise", self.nxtDenoiseIntensityHighFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT intensity low-frequency denoise", self.nxtDenoiseIntensityLowFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT color high-frequency denoise", self.nxtDenoiseColorHighFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT color low-frequency denoise", self.nxtDenoiseColorLowFreqEdit.text, 0, 1 );
            validateOptionalNumber( "NXT frequency scale", self.nxtFrequencyScaleEdit.text, 1, 100 );
            validateOptionalNumber( "NXT iterations", self.nxtIterationsEdit.text, 1, 5 );
         }

         if ( tool == "sxt" && self.sxtUnscreenCheck.checked && !self.sxtStarsCheck.checked )
            throw new Error( "SXT unscreen-stars requires stars-only output." );

         validateOptionalNumber( "Overlap", self.overlapEdit.text, 0, 0.5 );
         validateOptionalChoice( "Depth", self.outputDepthEdit.text, [ "8U", "16U", "32F", "64F" ] );
         if ( tool == "bxt" )
            validateExtraArguments( "BXT extra arguments", self.bxtExtraArgsEdit.text );
         else if ( tool == "sxt" )
            validateExtraArguments( "SXT extra arguments", self.sxtExtraArgsEdit.text );
         else
            validateExtraArguments( "NXT extra arguments", self.nxtExtraArgsEdit.text );

         validateExtraArguments( "Common extra arguments", self.commonExtraArgsEdit.text );

         if ( useActiveView )
         {
            if ( tempDir.length == 0 )
               throw new Error( "No temporary directory specified." );

            if ( !directoryExists( tempDir ) )
               throw new Error( "Temporary directory does not exist:\n" + tempDir );

            targetView = getTargetView();
            targetId = sanitizeIdentifier( targetView.id );

            try
            {
               inputDisplayState = captureViewDisplayState( targetView );
            }
            catch ( displayCaptureError )
            {
               writeConsoleWarning(
                  "Input STF capture failed",
                  "Processing will continue, but the result cannot inherit the input display STF.\n" +
                  displayCaptureError.toString()
               );
               log += "Input STF:  unavailable (" +
                  displayCaptureError.toString() + ")\n";
            }

            inputFile = pathJoin( tempDir, targetId + "_rcastro_input.xisf" );
            outputFile = pathJoin( tempDir, targetId + toolSuffix( tool ) + ".xisf" );
            logFile = pathJoin( tempDir, targetId + "_rcastro_" + tool + ".log" );
            temporaryInputFile = inputFile;

            self.inputEdit.text = inputFile;
            self.outputEdit.text = outputFile;
            self.logEdit.text = logFile;

            validateOutputPaths( inputFile, outputFile, logFile );
            self.saveSettings();

            self.statusText.text =
               "PREPARING\n\n" +
               "Target view:\n" +
               targetView.fullId + "\n\n" +
               "Saving active view to temporary XISF:\n" +
               inputFile;

            CoreApplication.processEvents();

            removeFileIfExists( inputFile );
            saveViewToXISF( targetView, inputFile );
         }
         else
         {
            if ( logFile.length == 0 )
               throw new Error( "No log file specified." );

            if ( inputFile.length == 0 )
               throw new Error( "No input file specified." );

            if ( outputFile.length == 0 )
               throw new Error( "No output file specified." );

            if ( !fileExists( inputFile ) )
               throw new Error( "Input file not found:\n" + inputFile );

            validateOutputPaths( inputFile, outputFile, logFile );
            self.saveSettings();

            var openInputView = findOpenViewForFile( inputFile );
            if ( openInputView != null )
            {
               try
               {
                  inputDisplayState = captureViewDisplayState( openInputView );
               }
               catch ( manualDisplayCaptureError )
               {
                  writeConsoleWarning(
                     "Input STF capture failed",
                     "The manual input file is open, but its display STF could not be read. " +
                     "Processing will continue.\n" +
                     manualDisplayCaptureError.toString()
                  );
                  log += "Input STF:  unavailable (" +
                     manualDisplayCaptureError.toString() + ")\n";
               }
            }
         }

         if ( fileExists( outputFile ) && !self.overwriteCheck.checked )
            throw new Error(
               "The output file already exists and overwrite is disabled:\n" +
               outputFile
            );

         if ( self.overwriteCheck.checked )
         {
            removeFileIfExists( outputFile );

            if ( tool == "sxt" && self.sxtStarsCheck.checked )
            {
               var oldStarsOutputs = sxtStarsOutputCandidates( outputFile );
               for ( var oldStarsIndex = 0;
                     oldStarsIndex < oldStarsOutputs.length;
                     ++oldStarsIndex )
                  removeFileIfExists( oldStarsOutputs[oldStarsIndex] );
            }
         }

         log += "Target view: " + ( targetView ? targetView.fullId : "n/a" ) + "\n";
         log += "Input:      " + inputFile + "\n";
         log += "Output:     " + outputFile + "\n";
         log += "Log:        " + logFile + "\n\n";
         if ( inputDisplayState != null )
            log += "Input STF:  " + inputDisplayState.description + "\n\n";
         else
            log += "Input STF:  unavailable; no display transform will be copied\n\n";

         var args = buildRCAstroArgs(
            tool,
            inputFile,
            outputFile,
            self.overwriteCheck.checked,

            self.bxtSharpenStarsEdit.text,
            self.bxtAdjustStarHalosEdit.text,
            self.bxtAutoNonstellarPsfCheck.checked,
            self.bxtNonstellarDiameterEdit.text,
            self.bxtSharpenNonstellarEdit.text,
            self.bxtCorrectOnlyCheck.checked,

            self.sxtStarsCheck.checked,
            self.sxtUnscreenCheck.checked,

            self.nxtDenoiseEdit.text,
            self.nxtDenoiseIntensityEdit.text,
            self.nxtDenoiseColorEdit.text,
            self.nxtDenoiseHighFreqEdit.text,
            self.nxtDenoiseLowFreqEdit.text,
            self.nxtDenoiseIntensityHighFreqEdit.text,
            self.nxtDenoiseIntensityLowFreqEdit.text,
            self.nxtDenoiseColorHighFreqEdit.text,
            self.nxtDenoiseColorLowFreqEdit.text,
            self.nxtFrequencyScaleEdit.text,
            self.nxtIterationsEdit.text,

            self.deviceEdit.text,
            self.mlVersionEdit.text,
            self.overlapEdit.text,
            self.outputDepthEdit.text,
            self.debugCheck.checked,

            self.bxtExtraArgsEdit.text,
            self.sxtExtraArgsEdit.text,
            self.nxtExtraArgsEdit.text,
            self.commonExtraArgsEdit.text
         );

         var commandLine = quoteForLog( rcAstroExe ) + " " + quoteArgsForLog( args );

         log += "Command:    " + commandLine + "\n";
         log += "Arguments:  " + quoteArgsForLog( args ) + "\n\n";

         self.statusText.text =
            "STARTING\n\n" +
            "Launching RC-Astro...\n\n" +
            "Tool: " + tool + "\n\n" +
            "Command:\n" +
            commandLine + "\n\n" +
            "Arguments:\n" +
            quoteArgsForLog( args );

         console.show();
         writeConsoleInfo(
            "Running RC-Astro CLI",
            "Mode: " + ( useActiveView ? "active PixInsight view" : "manual file" ) +
            "\nTool: " + tool +
            "\nExecutable: " + rcAstroExe +
            "\nCommand: " + commandLine
         );

         self.runButton.enabled = false;
         self.newInstanceButton.enabled = false;
         self.preferencesButton.enabled = false;
         self.closeButton.text = "Cancel";
         self.closeButton.enabled = true;
         self.processRunning = true;
         self.cancelRequested = false;

         CoreApplication.processEvents();

         var p = new ExternalProcess;
         p.start( rcAstroExe, args );

         var startTime = new Date();
         var lastDisplayedSecond = -1;
         var lastPercent = -1;
         var lastProgressKey = "";
         var stdoutBuffer = "";
         var stderrBuffer = "";
         var latestProgress = null;
         var spinnerFrames = [ "|", "/", "-", "\\" ];
         var parseTailLength = 65536;
         var frame = 0;
         var hadLiveProgress = false;
         var gpuUsed = "";
         var toolInfo = "";
         var maxSilentSeconds = 3300;
         var lastOutputChangeTime = startTime;
         var lastLogRefreshSecond = -1;

         File.writeTextFile(
            logFile,
            log +
            "Process started: " + nowString() + "\n" +
            "Status: waiting for RC-Astro output...\n"
         );

         writeConsoleInfo(
            "RC-Astro process started",
            "Progress is shown in the script window."
         );

         self.statusText.text =
            "RUNNING\n\n" +
            "RC-Astro has started.\n\n" +
            "Waiting for progress output...\n\n" +
            "GPU: detecting...\n\n" +
            "Input:\n" +
            inputFile + "\n\n" +
            "Output:\n" +
            outputFile + "\n\n" +
            "Command:\n" +
            commandLine;

         CoreApplication.processEvents();

         while ( !p.waitForFinished( 300 ) )
         {
            if ( self.cancelRequested )
            {
               wasCancelled = true;
               stopExternalProcess( p );
               throw new Error( "RC-Astro processing was cancelled by the user." );
            }

            var now = new Date();
            var elapsedSeconds = Math.floor(
               ( now.getTime() - startTime.getTime() ) / 1000
            );

            if ( !externalProcessIsRunning( p ) )
               break;

            var stdoutChunk = readProcessText( p, "stdout" );
            var stderrChunk = readProcessText( p, "stderr" );

            var outputChanged =
               stdoutChunk.length > 0 ||
               stderrChunk.length > 0;

            if ( outputChanged )
            {
               stdoutBuffer += stdoutChunk;
               stderrBuffer += stderrChunk;
               lastOutputChangeTime = now;

               var combinedLive =
                  tailString( stdoutBuffer, parseTailLength ) + "\n" +
                  tailString( stderrBuffer, parseTailLength );

               latestProgress = extractLatestRCAstroProgress( combinedLive );

               var gpuLive = extractRCAstroGpu( combinedLive );
               if ( gpuLive.length > 0 )
                  gpuUsed = gpuLive;

               var toolInfoLive = extractRCAstroToolInfo( combinedLive );
               if ( toolInfoLive.length > 0 )
                  toolInfo = toolInfoLive;
            }

            if ( latestProgress != null )
            {
               hadLiveProgress = true;

               var progressKey =
                  latestProgress.percent + "|" +
                  latestProgress.speed + "|" +
                  latestProgress.eta + "|" +
                  elapsedSeconds + "|" +
                  gpuUsed + "|" +
                  toolInfo;

               if ( progressKey != lastProgressKey ||
                    latestProgress.percent != lastPercent ||
                    elapsedSeconds != lastDisplayedSecond )
               {
                  var progressBar = makeTextProgressBar( latestProgress.percent, 30 );

                  updateTextBoxIfChanged(
                     self.statusText,
                     "RUNNING\n\n" +
                     "RC-Astro is processing.\n\n" +
                     progressBar + "  " + latestProgress.percent + "%\n\n" +
                     "Speed:   " + latestProgress.speed + " MP/s\n" +
                     "ETA:     " + latestProgress.eta + "\n" +
                     "Elapsed: " + elapsedSeconds + " s\n" +
                     "GPU:     " + ( gpuUsed.length > 0 ? gpuUsed : "detecting..." ) + "\n" +
                     "Command: " + tool + "\n" +
                     ( toolInfo.length > 0 ? "Tool:    " + toolInfo + "\n" : "" ) +
                     "\nOutput:\n" +
                     outputFile + "\n\n" +
                     "Command line:\n" +
                     commandLine
                  );

                  lastProgressKey = progressKey;
                  lastPercent = latestProgress.percent;
                  lastDisplayedSecond = elapsedSeconds;
               }
            }
            else
            {
               if ( elapsedSeconds != lastDisplayedSecond )
               {
                  var spinner = spinnerFrames[ frame % spinnerFrames.length ];
                  var movingBar = makeMovingBar( frame, 30 );

                  updateTextBoxIfChanged(
                     self.statusText,
                     "RUNNING " + spinner + "\n\n" +
                     "RC-Astro has started.\n\n" +
                     "Waiting for parseable progress output...\n\n" +
                     movingBar + "\n\n" +
                     "Elapsed: " + elapsedSeconds + " s\n" +
                     "GPU:     " + ( gpuUsed.length > 0 ? gpuUsed : "detecting..." ) + "\n" +
                     "Command: " + tool + "\n" +
                     ( toolInfo.length > 0 ? "Tool:    " + toolInfo + "\n" : "" ) +
                     "\nOutput:\n" +
                     outputFile + "\n\n" +
                     "Command line:\n" +
                     commandLine
                  );

                  lastDisplayedSecond = elapsedSeconds;
               }
            }

            var silentSeconds = Math.floor(
               ( now.getTime() - lastOutputChangeTime.getTime() ) / 1000
            );

            if ( silentSeconds > maxSilentSeconds )
            {
               stopExternalProcess( p );
               throw new Error(
                  "RC-Astro produced no new output for " +
                  maxSilentSeconds + " seconds, so the script stopped waiting.\n\n" +
                  "Partial stdout:\n" + tailString( stdoutBuffer, 4000 ) + "\n\n" +
                  "Partial stderr:\n" + tailString( stderrBuffer, 4000 )
               );
            }

            if ( elapsedSeconds != lastLogRefreshSecond && elapsedSeconds % 15 == 0 )
            {
               lastLogRefreshSecond = elapsedSeconds;
               File.writeTextFile(
                  logFile,
                  log +
                  "Process running: " + nowString() + "\n" +
                  "Elapsed: " + elapsedSeconds + " s\n" +
                  "Silent:  " + silentSeconds + " s\n\n" +
                  "----- LIVE STDOUT TAIL -----\n" +
                  tailString( stdoutBuffer, 8000 ) + "\n\n" +
                  "----- LIVE STDERR TAIL -----\n" +
                  tailString( stderrBuffer, 8000 ) + "\n"
               );
            }

            frame++;
            CoreApplication.processEvents();
         }

         var endTime = new Date();
         var totalSeconds = Math.floor(
            ( endTime.getTime() - startTime.getTime() ) / 1000
         );

         var exitCode = p.exitCode;
         stdoutBuffer += readProcessText( p, "stdout" );
         stderrBuffer += readProcessText( p, "stderr" );
         var stdoutText = stdoutBuffer;
         var stderrText = stderrBuffer;

         var finalCombined = stdoutText + "\n" + stderrText;

         var gpuFinal = extractRCAstroGpu( finalCombined );
         if ( gpuFinal.length > 0 )
            gpuUsed = gpuFinal;

         var toolInfoFinal = extractRCAstroToolInfo( finalCombined );
         if ( toolInfoFinal.length > 0 )
            toolInfo = toolInfoFinal;

         self.statusText.text =
            "COMPLETED\n\n" +
            "RC-Astro has finished.\n\n" +
            "Elapsed: " + totalSeconds + " s\n" +
            "Exit code: " + exitCode + "\n" +
            "GPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n\n" +
            "Checking output and writing log...";

         CoreApplication.processEvents();

         log += "Exit code:  " + exitCode + "\n";
         log += "Elapsed:    " + totalSeconds + " s\n";
         log += "Live progress parsed: " + ( hadLiveProgress ? "yes" : "no" ) + "\n";
         log += "GPU used:   " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n";
         log += "Tool info:  " + ( toolInfo.length > 0 ? toolInfo : "unknown" ) + "\n\n";
         log += "----- STDOUT -----\n";
         log += stdoutText + "\n\n";
         log += "----- STDERR -----\n";
         log += stderrText + "\n\n";
         log += "Finished:   " + nowString() + "\n";

         File.writeTextFile( logFile, log );

         writeConsoleInfo(
            "RC-Astro process completed",
            "Elapsed: " + totalSeconds + " s" +
            "\nExit code: " + exitCode +
            "\nGPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) +
            "\nLog file: " + logFile
         );

         if ( exitCode === 0 )
         {
            if ( fileExists( outputFile ) && fileSize( outputFile ) > 0 )
            {
               var sxtStarsOutputFile = "";
               var sxtStarsOpened = false;

               if ( openResult )
               {
                  self.statusText.text =
                     "OPENING RESULT\n\n" +
                     "RC-Astro finished successfully.\n\n" +
                     "Opening output in PixInsight:\n" +
                     outputFile;

                  CoreApplication.processEvents();

                  var openedResult = openOutputImage(
                     outputFile,
                     inputDisplayState
                  );
                  outputWindow = openedResult.window;
                  resultDisplayDescription =
                     openedResult.displayDescription;
                  log += "Result STF: " +
                     resultDisplayDescription + "\n";
               }

               if ( tool == "sxt" && self.sxtStarsCheck.checked )
               {
                  sxtStarsOutputFile = findSxtStarsOutputFile( outputFile );

                  if ( sxtStarsOutputFile.length > 0 )
                  {
                     self.statusText.text =
                        "OPENING SXT STARS IMAGE\n\n" +
                        "RC-Astro finished successfully.\n\n" +
                        "Opening stars-only output in PixInsight:\n" +
                        sxtStarsOutputFile;

                     CoreApplication.processEvents();

                     var openedStars = openOutputImage(
                        sxtStarsOutputFile,
                        inputDisplayState
                     );
                     sxtStarsOpened = true;
                     log += "SXT stars:  " + sxtStarsOutputFile + "\n";
                     log += "Stars STF:  " +
                        openedStars.displayDescription + "\n";
                  }
                  else
                  {
                     log += "SXT stars:  requested, but no companion stars-only output was found beside the starless output.\n";
                  }
               }

               File.writeTextFile( logFile, log );

               var finalBar = makeTextProgressBar( 100, 30 );

               self.statusText.text =
                  "SUCCESS\n\n" +
                  "RC-Astro finished successfully.\n\n" +
                  finalBar + "  100%\n\n" +
                  "Elapsed: " + totalSeconds + " s\n" +
                  "Exit code: 0\n" +
                  "GPU:     " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n" +
                  "Command: " + tool + "\n" +
                  ( toolInfo.length > 0 ? "Tool:    " + toolInfo + "\n" : "" ) +
                  "Mode:    " + ( useActiveView ? "active PixInsight view" : "manual file" ) + "\n" +
                  "Result opened: " + ( openResult ? "yes" : "no" ) + "\n\n" +
                  ( sxtStarsOutputFile.length > 0 ? "SXT stars opened: " + ( sxtStarsOpened ? "yes" : "no" ) + "\n\n" : "" ) +
                  "Output:\n" + outputFile + "\n\n" +
                  ( sxtStarsOutputFile.length > 0 ? "SXT stars output:\n" + sxtStarsOutputFile + "\n\n" : "" ) +
                  "Log:\n" + logFile;

            }
            else
            {
               self.statusText.text =
                  "WARNING\n\n" +
                  "RC-Astro returned exit code 0, but the expected output file is missing or empty.\n\n" +
                  "Elapsed: " + totalSeconds + " s\n" +
                  "GPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n\n" +
                  "Expected output:\n" + outputFile + "\n\n" +
                  "Log:\n" + logFile;

               writeConsoleWarning(
                  "RC-Astro warning",
                  "RC-Astro returned exit code 0, but the expected output file is missing or empty.\n\n" +
                  "Elapsed: " + totalSeconds + " s\n" +
                  "GPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n\n" +
                  "Expected output:\n" + outputFile + "\n\n" +
                  "Check log:\n" + logFile
               );
            }
         }
         else
         {
            self.statusText.text =
               "FAILED\n\n" +
               "RC-Astro returned a non-zero exit code.\n\n" +
               "Elapsed: " + totalSeconds + " s\n" +
               "Exit code: " + exitCode + "\n" +
               "GPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n\n" +
               "Log:\n" + logFile + "\n\n" +
               "STDERR tail:\n" + tailString( stderrText, 8000 );

            writeConsoleError(
               "RC-Astro failed",
               "RC-Astro returned a non-zero exit code: " + exitCode + "\n\n" +
               "Elapsed: " + totalSeconds + " s\n" +
               "GPU: " + ( gpuUsed.length > 0 ? gpuUsed : "unknown" ) + "\n\n" +
               "Check log:\n" + logFile + "\n\n" +
               "STDERR tail:\n" + tailString( stderrText, 8000 )
            );
         }
      }
      catch ( e )
      {
         log += "\n----- SCRIPT EXCEPTION -----\n";
         log += e.toString() + "\n";
         log += "Finished: " + nowString() + "\n";

         try
         {
            if ( logFile && logFile.length > 0 )
               File.writeTextFile( logFile, log );
         }
         catch ( ignored5 )
         {
         }

         if ( wasCancelled )
         {
            self.statusText.text =
               "CANCELLED\n\n" +
               "RC-Astro processing was cancelled.\n\n" +
               "Log:\n" + logFile;

            writeConsoleWarning(
               "RC-Astro cancelled",
               "Processing was cancelled.\n\nLog:\n" + logFile
            );
         }
         else
         {
            self.statusText.text =
               "SCRIPT ERROR\n\n" +
               e.toString() + "\n\n" +
               "Log:\n" + logFile;

            writeConsoleError(
               "RC-Astro script error",
               e.toString() + "\n\nLog:\n" + logFile
            );
         }
      }
      finally
      {
         if ( useActiveView && !keepTemp && temporaryInputFile.length > 0 )
         {
            try
            {
               removeFileIfExists( temporaryInputFile );
            }
            catch ( cleanupError )
            {
               writeConsoleWarning(
                  "Temporary file cleanup failed",
                  cleanupError.toString()
               );
            }
         }

         self.runButton.enabled = true;
         self.newInstanceButton.enabled = true;
         self.preferencesButton.enabled = true;
         self.processRunning = false;
         self.cancelRequested = false;
         self.closeButton.text = "Close";
         self.closeButton.enabled = true;
         CoreApplication.processEvents();
      }
   };

   this.updateToolVisibility();
   this.adjustToContents();
   }
};

// -----------------------------------------------------------------------------
// Launch GUI
// -----------------------------------------------------------------------------

console.show();
writeConsoleInfo( "RC-Astro GUI wrapper loaded", "" );

var startupExecutable = settingsReadString(
   "RcAstroGUI/exe",
   defaultRCAstroExecutable()
);
var startupCliVersion = null;
var startupCliError = "";

try
{
   startupCliVersion = verifyRCAstroCompatibility( startupExecutable );
   writeConsoleInfo(
      "RC-Astro CLI detected",
      "Version: " + versionString( startupCliVersion ) +
      "\nExecutable: " + startupExecutable
   );
}
catch ( startupError )
{
   startupCliError = startupError.toString();
   showError(
      "RC-Astro CLI unavailable",
      startupCliError +
      "\n\nOpen Preferences to configure a compatible RC-Astro CLI executable."
   );
}

var dialog = new RunRCAstroDialog;
dialog.execute();

